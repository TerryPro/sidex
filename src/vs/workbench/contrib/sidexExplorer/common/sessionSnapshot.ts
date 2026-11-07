/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 会话快照的唯一格式定义。
 *
 * 目录标签、每个标签的工作集、未保存内容备份与文件列表滚动位置全部写进
 * `sidex.session.snapshot` 这一个键，避免多键各自为政导致恢复时序错乱。
 *
 * 这里只放纯函数与纯类型：不依赖 DOM，也不依赖任何 VS Code 服务，
 * 因此可以直接被 node:test 加载。
 */

/** 当前快照键；旧的四个键在首次启动时迁移后删除。 */
export const SESSION_SNAPSHOT_KEY = 'sidex.session.snapshot';

/** 快照格式版本；不认识的版本一律视为损坏。 */
export const SESSION_SNAPSHOT_SCHEMA_VERSION = 1;

/** 旧键（迁移后删除）。 */
export const LEGACY_TABS_KEY = 'sidex.directory.tabs';
export const LEGACY_SESSIONS_KEY = 'sidex.directory.editorSessions';
export const LEGACY_BACKUPS_KEY = 'sidex.directory.fileBackups';
export const LEGACY_SCROLL_PREFIX = 'sidex.directory.scroll:';

/** 单个备份文件的上限：5MB（按 UTF-8 字节计）。 */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
/** 全部备份的总量上限：50MB。 */
export const MAX_TOTAL_BACKUP_BYTES = 50 * 1024 * 1024;
/** 备份条目数上限。 */
export const MAX_BACKUPS = 200;

export interface SnapshotTab {
	readonly id: string;
	readonly location: string;
	readonly history: readonly string[];
	readonly historyIndex: number;
}

export interface SnapshotEditor {
	readonly resource: string;
	readonly groupId: number;
	readonly pinned: boolean;
	readonly dirty: boolean;
	/** 保存会话时磁盘文件的修改时间；用于启动时检测外部修改。 */
	readonly diskMtime?: number;
	/** 仅未命名缓冲区保存内容；普通文件的内容放在 backups 里。 */
	readonly contents?: string;
	readonly viewState?: unknown;
}

export interface SnapshotSession {
	readonly editors: readonly SnapshotEditor[];
	readonly activeIndex?: number;
}

export interface SnapshotBackup {
	readonly content: string;
	readonly diskMtime?: number;
	/** 最近一次内容变化的时刻；内容未变时沿用旧值，用于按最久未改动淘汰。 */
	readonly updatedAt: number;
}

export interface SessionSnapshot {
	readonly schemaVersion: number;
	readonly tabs: readonly SnapshotTab[];
	readonly activeTabId?: string;
	readonly sessions: Readonly<Record<string, SnapshotSession>>;
	readonly backups: Readonly<Record<string, SnapshotBackup>>;
	/** 键为目录标签 id。 */
	readonly scrollTops: Readonly<Record<string, number>>;
}

/** 采集阶段交给快照模块的编辑器信息。 */
export interface CapturedEditor {
	readonly resource: string;
	readonly groupId: number;
	readonly pinned: boolean;
	readonly dirty: boolean;
	/** 未保存时的完整文本；普通文件用它生成备份，未命名缓冲区直接随会话保存。 */
	readonly contents?: string;
	readonly viewState?: unknown;
}

export interface CapturedSession {
	readonly tabId: string;
	readonly editors: readonly CapturedEditor[];
	readonly activeIndex?: number;
}

export interface CaptureInput {
	readonly sessions: readonly CapturedSession[];
	/** 已采集的磁盘 mtime，键为资源字符串；缺失表示无法读取。 */
	readonly diskMtimes: ReadonlyMap<string, number>;
}

/** 旧键里的原始字符串，键为完整存储键。 */
export interface LegacySnapshotInput {
	readonly tabs?: string;
	readonly sessions?: string;
	readonly backups?: string;
	readonly scrolls?: Readonly<Record<string, string>>;
}

export function isUntitledResource(resource: string): boolean {
	return resource.startsWith('untitled:');
}

/** UTF-8 字节长度；容量判断统一用它，避免中文内容被低估。 */
export function utf8Length(text: string): number {
	let bytes = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff) {
			// 代理对：一个字符 4 字节，跳过低位代理。
			bytes += 4;
			index++;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

export function createEmptySnapshot(): SessionSnapshot {
	return {
		schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
		tabs: [],
		activeTabId: undefined,
		sessions: {},
		backups: {},
		scrollTops: {}
	};
}

export function serializeSnapshot(snapshot: SessionSnapshot): string {
	return JSON.stringify(snapshot);
}

/** 解析快照；版本不认识或结构损坏时返回 undefined，由调用方清空。 */
export function parseSnapshot(raw: string | undefined): SessionSnapshot | undefined {
	if (!raw) {
		return undefined;
	}

	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!data || typeof data !== 'object') {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	if (record.schemaVersion !== SESSION_SNAPSHOT_SCHEMA_VERSION) {
		return undefined;
	}

	const tabs: SnapshotTab[] = [];
	if (Array.isArray(record.tabs)) {
		for (const item of record.tabs) {
			const tab = asRecord(item);
			if (!tab || typeof tab.id !== 'string' || typeof tab.location !== 'string') {
				continue;
			}
			tabs.push({
				id: tab.id,
				location: tab.location,
				history: stringArray(tab.history, tab.location),
				historyIndex: typeof tab.historyIndex === 'number' ? tab.historyIndex : 0
			});
		}
	}

	const sessions: Record<string, SnapshotSession> = {};
	const sessionsRecord = asRecord(record.sessions);
	if (sessionsRecord) {
		for (const [tabId, value] of Object.entries(sessionsRecord)) {
			const session = asRecord(value);
			if (!session || !Array.isArray(session.editors)) {
				continue;
			}
			const editors: SnapshotEditor[] = [];
			for (const item of session.editors) {
				const editor = asRecord(item);
				if (!editor || typeof editor.resource !== 'string' || !editor.resource) {
					continue;
				}
				editors.push({
					resource: editor.resource,
					groupId: typeof editor.groupId === 'number' ? editor.groupId : 1,
					pinned: editor.pinned === true,
					dirty: editor.dirty === true,
					diskMtime: typeof editor.diskMtime === 'number' ? editor.diskMtime : undefined,
					contents: typeof editor.contents === 'string' ? editor.contents : undefined,
					viewState: editor.viewState
				});
			}
			if (editors.length) {
				sessions[tabId] = {
					editors,
					activeIndex: typeof session.activeIndex === 'number' ? session.activeIndex : undefined
				};
			}
		}
	}

	const backups: Record<string, SnapshotBackup> = {};
	const backupsRecord = asRecord(record.backups);
	if (backupsRecord) {
		for (const [resource, value] of Object.entries(backupsRecord)) {
			const backup = asRecord(value);
			if (!backup || typeof backup.content !== 'string') {
				continue;
			}
			backups[resource] = {
				content: backup.content,
				diskMtime: typeof backup.diskMtime === 'number' ? backup.diskMtime : undefined,
				updatedAt: typeof backup.updatedAt === 'number' && Number.isFinite(backup.updatedAt) ? backup.updatedAt : 0
			};
		}
	}

	const scrollTops: Record<string, number> = {};
	const scrollsRecord = asRecord(record.scrollTops);
	if (scrollsRecord) {
		for (const [tabId, value] of Object.entries(scrollsRecord)) {
			const top = typeof value === 'number' ? value : Number(value);
			if (Number.isFinite(top) && top > 0) {
				scrollTops[tabId] = top;
			}
		}
	}

	return {
		schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
		tabs,
		activeTabId: typeof record.activeTabId === 'string' ? record.activeTabId : undefined,
		sessions,
		backups,
		scrollTops
	};
}

/**
 * 把旧的四个键合并成一份快照；没有任何旧数据时返回 undefined。
 * 单个键损坏只丢弃该键，不影响其余部分。
 */
export function migrateLegacySnapshot(legacy: LegacySnapshotInput): SessionSnapshot | undefined {
	const hasLegacy = !!(legacy.tabs || legacy.sessions || legacy.backups
		|| (legacy.scrolls && Object.keys(legacy.scrolls).length));
	if (!hasLegacy) {
		return undefined;
	}

	let snapshot = createEmptySnapshot();

	const tabsData = parseJson(legacy.tabs);
	if (Array.isArray(tabsData?.tabs)) {
		const tabs: SnapshotTab[] = [];
		for (const item of tabsData.tabs) {
			const tab = asRecord(item);
			if (!tab || typeof tab.id !== 'string' || typeof tab.location !== 'string') {
				continue;
			}
			tabs.push({
				id: tab.id,
				location: tab.location,
				history: stringArray(tab.history, tab.location),
				historyIndex: typeof tab.historyIndex === 'number' ? tab.historyIndex : 0
			});
		}
		snapshot = { ...snapshot, tabs, activeTabId: typeof tabsData.active === 'string' ? tabsData.active : undefined };
	}

	const sessionsData = asRecord(parseJson(legacy.sessions));
	if (sessionsData) {
		const sessions: Record<string, SnapshotSession> = {};
		for (const [tabId, value] of Object.entries(sessionsData)) {
			const session = asRecord(value);
			if (!session || !Array.isArray(session.editors)) {
				continue;
			}
			const editors: SnapshotEditor[] = [];
			for (const item of session.editors) {
				const editor = asRecord(item);
				if (!editor || typeof editor.resource !== 'string' || !editor.resource) {
					continue;
				}
				editors.push({
					resource: editor.resource,
					groupId: typeof editor.groupId === 'number' ? editor.groupId : 1,
					pinned: editor.pinned === true,
					dirty: editor.dirty === true,
					diskMtime: typeof editor.diskMtime === 'number' ? editor.diskMtime : undefined,
					contents: typeof editor.contents === 'string' ? editor.contents : undefined,
					viewState: editor.viewState
				});
			}
			if (editors.length) {
				sessions[tabId] = {
					editors,
					activeIndex: typeof session.activeIndex === 'number' ? session.activeIndex : undefined
				};
			}
		}
		snapshot = { ...snapshot, sessions };
	}

	const backupsData = asRecord(parseJson(legacy.backups));
	if (backupsData) {
		const backups: Record<string, SnapshotBackup> = {};
		for (const [resource, value] of Object.entries(backupsData)) {
			const backup = asRecord(value);
			if (!backup || typeof backup.content !== 'string') {
				continue;
			}
			backups[resource] = {
				content: backup.content,
				diskMtime: typeof backup.diskMtime === 'number' ? backup.diskMtime : undefined,
				updatedAt: 0
			};
		}
		snapshot = { ...snapshot, backups };
	}

	if (legacy.scrolls) {
		const scrollTops: Record<string, number> = {};
		for (const [key, value] of Object.entries(legacy.scrolls)) {
			if (!key.startsWith(LEGACY_SCROLL_PREFIX)) {
				continue;
			}
			const top = Number(value);
			if (Number.isFinite(top) && top > 0) {
				scrollTops[key.slice(LEGACY_SCROLL_PREFIX.length)] = top;
			}
		}
		snapshot = { ...snapshot, scrollTops };
	}

	return snapshot;
}

/** 采集当前会话，保留上一次的标签、滚动位置与未变化备份的时间戳。 */
export function buildSnapshot(input: CaptureInput, previous: SessionSnapshot, now: number): SessionSnapshot {
	const tabIds = new Set(previous.tabs.map(tab => tab.id));
	const sessions: Record<string, SnapshotSession> = {};
	const backups: Record<string, SnapshotBackup> = {};

	for (const session of input.sessions) {
		if (!tabIds.has(session.tabId)) {
			continue;
		}
		const editors: SnapshotEditor[] = [];
		for (const editor of session.editors) {
			if (!editor.resource) {
				continue;
			}
			const untitled = isUntitledResource(editor.resource);
			const diskMtime = untitled ? undefined : input.diskMtimes.get(editor.resource);

			if (!untitled && editor.dirty && editor.contents !== undefined) {
				if (utf8Length(editor.contents) <= MAX_BACKUP_BYTES) {
					const previousBackup = previous.backups[editor.resource];
					backups[editor.resource] = {
						content: editor.contents,
						diskMtime,
						updatedAt: previousBackup && previousBackup.content === editor.contents ? previousBackup.updatedAt : now
					};
				}
			}

			editors.push({
				resource: editor.resource,
				groupId: editor.groupId,
				pinned: editor.pinned,
				dirty: editor.dirty,
				diskMtime,
				contents: untitled ? editor.contents : undefined,
				viewState: editor.viewState
			});
		}
		if (editors.length) {
			sessions[session.tabId] = { editors, activeIndex: session.activeIndex };
		}
	}

	return pruneBackups({ ...previous, sessions, backups });
}

/** 丢弃超限备份并淘汰最久未改动者，返回新快照。 */
export function pruneBackups(snapshot: SessionSnapshot): SessionSnapshot {
	const candidates = Object.entries(snapshot.backups)
		.filter(([, backup]) => !!backup && typeof backup.content === 'string' && utf8Length(backup.content) <= MAX_BACKUP_BYTES)
		.sort((a, b) => (b[1].updatedAt - a[1].updatedAt) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

	const backups: Record<string, SnapshotBackup> = {};
	let total = 0;
	let count = 0;
	for (const [resource, backup] of candidates) {
		if (count >= MAX_BACKUPS) {
			break;
		}
		const bytes = utf8Length(backup.content);
		if (total + bytes > MAX_TOTAL_BACKUP_BYTES) {
			continue;
		}
		backups[resource] = backup;
		total += bytes;
		count++;
	}

	return { ...snapshot, backups };
}

/**
 * 找出启动后磁盘被外部改动的未保存文件。
 * `currentMtimes` 缺少某个资源时视为读取失败，跳过（保持旧行为）。
 */
export function diffExternalChanges(
	editors: readonly SnapshotEditor[],
	currentMtimes: ReadonlyMap<string, number | undefined>
): readonly string[] {
	const changed: string[] = [];
	for (const editor of editors) {
		if (!editor.dirty || !editor.resource || isUntitledResource(editor.resource)) {
			continue;
		}
		const current = currentMtimes.get(editor.resource);
		if (current === undefined) {
			continue;
		}
		if (editor.diskMtime === undefined || current !== editor.diskMtime) {
			changed.push(editor.resource);
		}
	}
	return changed;
}

/** 启动后需要检查外部修改的编辑器：未保存、有磁盘时间、属于现存标签。 */
export function collectExternalCandidates(
	snapshot: SessionSnapshot,
	tabIds: ReadonlySet<string>
): readonly SnapshotEditor[] {
	const candidates: SnapshotEditor[] = [];
	for (const [tabId, session] of Object.entries(snapshot.sessions)) {
		if (!tabIds.has(tabId)) {
			continue;
		}
		for (const editor of session.editors) {
			if (editor.dirty && editor.diskMtime !== undefined && !isUntitledResource(editor.resource)) {
				candidates.push(editor);
			}
		}
	}
	return candidates;
}

function asRecord(value: unknown): Record<string, any> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function parseJson(raw: string | undefined): Record<string, any> | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		return asRecord(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function stringArray(value: unknown, fallback: string): readonly string[] {
	if (!Array.isArray(value)) {
		return [fallback];
	}
	const items = value.filter((item): item is string => typeof item === 'string');
	return items.length ? items : [fallback];
}
