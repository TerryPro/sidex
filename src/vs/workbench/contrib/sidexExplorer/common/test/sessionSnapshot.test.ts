import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SnapshotBackup, SessionSnapshot } from '../sessionSnapshot.ts';
import {
	LEGACY_SCROLL_PREFIX,
	MAX_BACKUPS,
	MAX_BACKUP_BYTES,
	SESSION_SNAPSHOT_SCHEMA_VERSION,
	buildSnapshot,
	collectExternalCandidates,
	createEmptySnapshot,
	diffExternalChanges,
	isUntitledResource,
	migrateLegacySnapshot,
	parseSnapshot,
	pruneBackups,
	serializeSnapshot,
	utf8Length
} from '../sessionSnapshot.ts';

function snapshotWith(overrides: Partial<SessionSnapshot>): SessionSnapshot {
	return { ...createEmptySnapshot(), ...overrides };
}

function backup(content: string, updatedAt: number): SnapshotBackup {
	return { content, updatedAt };
}

function tab(id: string): { id: string; location: string; history: string[]; historyIndex: number } {
	return { id, location: `D:\\${id}`, history: [`D:\\${id}`], historyIndex: 0 };
}

test('utf8Length 按 UTF-8 字节计算', () => {
	assert.equal(utf8Length(''), 0);
	assert.equal(utf8Length('abc'), 3);
	assert.equal(utf8Length('中'), 3);
	assert.equal(utf8Length('😀'), 4);
});

test('isUntitledResource 识别未命名缓冲区', () => {
	assert.equal(isUntitledResource('untitled:Untitled-1'), true);
	assert.equal(isUntitledResource('file:///D:/a.txt'), false);
});

test('序列化与解析可往返', () => {
	const snapshot = snapshotWith({
		tabs: [tab('t1')],
		activeTabId: 't1',
		sessions: {
			t1: {
				editors: [{ resource: 'file:///D:/a.txt', groupId: 1, pinned: true, dirty: true, diskMtime: 10, viewState: { cursor: 3 } }],
				activeIndex: 0
			}
		},
		backups: { 'file:///D:/a.txt': backup('hello', 100) },
		scrollTops: { t1: 42 }
	});

	const parsed = parseSnapshot(serializeSnapshot(snapshot));
	assert.ok(parsed);
	assert.equal(parsed.schemaVersion, SESSION_SNAPSHOT_SCHEMA_VERSION);
	assert.deepEqual(parsed.tabs, snapshot.tabs);
	assert.equal(parsed.activeTabId, 't1');
	assert.deepEqual(parsed.sessions.t1.editors[0].viewState, { cursor: 3 });
	assert.equal(parsed.backups['file:///D:/a.txt'].content, 'hello');
	assert.equal(parsed.backups['file:///D:/a.txt'].updatedAt, 100);
	assert.equal(parsed.scrollTops.t1, 42);
});

test('解析拒绝损坏数据与未知版本', () => {
	assert.equal(parseSnapshot(undefined), undefined);
	assert.equal(parseSnapshot('{'), undefined);
	assert.equal(parseSnapshot('[]'), undefined);
	assert.equal(parseSnapshot(JSON.stringify({ schemaVersion: 99 })), undefined);
	assert.equal(parseSnapshot(JSON.stringify({ schemaVersion: 1, tabs: 'x', sessions: 3 }))?.tabs.length, 0);
});

test('迁移旧键：合并标签、会话、备份与滚动位置', () => {
	const migrated = migrateLegacySnapshot({
		tabs: JSON.stringify({
			active: 't2',
			tabs: [{ id: 't1', location: 'D:\\a', history: ['D:\\a'], historyIndex: 0 }, { id: 't2', location: 'D:\\b' }]
		}),
		sessions: JSON.stringify({
			t1: {
				activeIndex: 0,
				editors: [{ resource: 'file:///D:/a.txt', groupId: 1, pinned: false, dirty: true, diskMtime: 7 }]
			}
		}),
		backups: JSON.stringify({ 'file:///D:/a.txt': { content: 'draft', diskMtime: 7 } }),
		scrolls: {
			[`${LEGACY_SCROLL_PREFIX}t1`]: '120',
			[`${LEGACY_SCROLL_PREFIX}t2`]: '0',
			'sidex.other.key': '9'
		}
	});

	assert.ok(migrated);
	assert.equal(migrated.schemaVersion, SESSION_SNAPSHOT_SCHEMA_VERSION);
	assert.equal(migrated.tabs.length, 2);
	assert.deepEqual(migrated.tabs[1].history, ['D:\\b']);
	assert.equal(migrated.activeTabId, 't2');
	assert.equal(migrated.sessions.t1.editors[0].diskMtime, 7);
	assert.equal(migrated.backups['file:///D:/a.txt'].content, 'draft');
	assert.deepEqual(migrated.scrollTops, { t1: 120 });
});

test('迁移旧键：单个键损坏只丢该键，全空时返回 undefined', () => {
	assert.equal(migrateLegacySnapshot({}), undefined);
	assert.equal(migrateLegacySnapshot({ scrolls: {} }), undefined);

	const migrated = migrateLegacySnapshot({
		tabs: 'not json',
		backups: JSON.stringify({ 'file:///D:/a.txt': { content: 'x' } })
	});
	assert.ok(migrated);
	assert.equal(migrated.tabs.length, 0);
	assert.equal(migrated.backups['file:///D:/a.txt'].content, 'x');
});

test('buildSnapshot：未命名缓冲区随会话保存，普通文件生成备份', () => {
	const previous = snapshotWith({ tabs: [tab('t1')] });
	const result = buildSnapshot({
		sessions: [{
			tabId: 't1',
			activeIndex: 1,
			editors: [
				{ resource: 'untitled:Untitled-1', groupId: 1, pinned: false, dirty: true, contents: 'scratch' },
				{ resource: 'file:///D:/a.txt', groupId: 1, pinned: false, dirty: true, contents: 'draft' },
				{ resource: 'file:///D:/b.txt', groupId: 1, pinned: false, dirty: false, contents: 'ignored' }
			]
		}],
		diskMtimes: new Map([['file:///D:/a.txt', 99]])
	}, previous, 1000);

	assert.equal(result.sessions.t1.activeIndex, 1);
	assert.equal(result.sessions.t1.editors[0].contents, 'scratch');
	assert.equal(result.sessions.t1.editors[1].diskMtime, 99);
	assert.equal(result.sessions.t1.editors[1].contents, undefined);
	assert.deepEqual(Object.keys(result.backups), ['file:///D:/a.txt']);
	assert.equal(result.backups['file:///D:/a.txt'].diskMtime, 99);
	assert.equal(result.backups['file:///D:/a.txt'].updatedAt, 1000);
});

test('buildSnapshot：丢弃不存在标签的会话，内容未变时沿用旧时间戳', () => {
	const previous = snapshotWith({
		tabs: [tab('t1')],
		backups: { 'file:///D:/a.txt': backup('same', 500) }
	});
	const result = buildSnapshot({
		sessions: [
			{ tabId: 'gone', editors: [{ resource: 'file:///D:/x.txt', groupId: 1, pinned: false, dirty: false }] },
			{ tabId: 't1', editors: [{ resource: 'file:///D:/a.txt', groupId: 1, pinned: false, dirty: true, contents: 'same' }] }
		],
		diskMtimes: new Map()
	}, previous, 2000);

	assert.equal(result.sessions.gone, undefined);
	assert.equal(result.backups['file:///D:/a.txt'].updatedAt, 500);
});

test('pruneBackups：丢弃超大备份并按最久未改动淘汰', () => {
	const oversized = 'a'.repeat(MAX_BACKUP_BYTES + 1);
	const backups: Record<string, SnapshotBackup> = { 'file:///D:/huge.txt': backup(oversized, 9999) };
	for (let index = 0; index < MAX_BACKUPS + 5; index++) {
		backups[`file:///D:/${index}.txt`] = backup(`v${index}`, index);
	}

	const result = pruneBackups(snapshotWith({ backups }));
	assert.equal(Object.keys(result.backups).length, MAX_BACKUPS);
	assert.equal(result.backups['file:///D:/huge.txt'], undefined);
	assert.equal(result.backups['file:///D:/0.txt'], undefined);
	assert.ok(result.backups[`file:///D:/${MAX_BACKUPS + 4}.txt`]);
});

test('pruneBackups：总量超过 50MB 时淘汰最久未改动者', () => {
	const chunk = 'a'.repeat(MAX_BACKUP_BYTES);
	const backups: Record<string, SnapshotBackup> = {};
	for (let index = 0; index < 11; index++) {
		backups[`file:///D:/${index}.txt`] = backup(chunk, index);
	}

	const result = pruneBackups(snapshotWith({ backups }));
	const kept = Object.keys(result.backups);
	// 11 份 5MB 超过 50MB 预算，最旧的 1 份被淘汰。
	assert.equal(kept.length, 10);
	assert.equal(result.backups['file:///D:/0.txt'], undefined);
});

test('diffExternalChanges 只报告磁盘时间变化的未保存文件', () => {
	const editors = [
		{ resource: 'file:///D:/a.txt', groupId: 1, pinned: false, dirty: true, diskMtime: 10 },
		{ resource: 'file:///D:/b.txt', groupId: 1, pinned: false, dirty: true, diskMtime: 10 },
		{ resource: 'file:///D:/c.txt', groupId: 1, pinned: false, dirty: true },
		{ resource: 'file:///D:/d.txt', groupId: 1, pinned: false, dirty: false, diskMtime: 10 },
		{ resource: 'untitled:Untitled-1', groupId: 1, pinned: false, dirty: true }
	];
	const mtimes = new Map<string, number | undefined>([
		['file:///D:/a.txt', 10],
		['file:///D:/b.txt', 11],
		['file:///D:/c.txt', 12],
		['file:///D:/d.txt', 13]
	]);

	assert.deepEqual(diffExternalChanges(editors, mtimes), ['file:///D:/b.txt', 'file:///D:/c.txt']);
});

test('collectExternalCandidates 只收集现存标签里的未保存文件', () => {
	const snapshot = snapshotWith({
		tabs: [tab('t1')],
		sessions: {
			t1: { editors: [
				{ resource: 'file:///D:/a.txt', groupId: 1, pinned: false, dirty: true, diskMtime: 1 },
				{ resource: 'file:///D:/b.txt', groupId: 1, pinned: false, dirty: false, diskMtime: 1 },
				{ resource: 'untitled:Untitled-1', groupId: 1, pinned: false, dirty: true }
			] },
			gone: { editors: [{ resource: 'file:///D:/c.txt', groupId: 1, pinned: false, dirty: true, diskMtime: 1 }] }
		}
	});

	const candidates = collectExternalCandidates(snapshot, new Set(['t1']));
	assert.deepEqual(candidates.map(editor => editor.resource), ['file:///D:/a.txt']);
});
