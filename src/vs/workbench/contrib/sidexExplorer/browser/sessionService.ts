/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 会话快照的存储与编排。
 *
 * 这是「会话恢复」的唯一入口：目录标签、工作集、未保存内容备份与滚动位置
 * 都通过这里读写同一个存储键。格式与合并规则在 common/sessionSnapshot.ts。
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { HotExitConfiguration, IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
import {
	CapturedSession,
	LEGACY_BACKUPS_KEY,
	LEGACY_SCROLL_PREFIX,
	LEGACY_SESSIONS_KEY,
	LEGACY_TABS_KEY,
	SESSION_SNAPSHOT_KEY,
	SnapshotEditor,
	SnapshotTab,
	SessionSnapshot,
	buildSnapshot,
	collectExternalCandidates,
	createEmptySnapshot,
	diffExternalChanges,
	isUntitledResource,
	migrateLegacySnapshot,
	parseSnapshot,
	pruneBackups,
	serializeSnapshot
} from '../common/sessionSnapshot.js';

export const ISessionService = createDecorator<ISessionService>('sidexSessionService');

export interface ISessionService {
	readonly _serviceBrand: undefined;

	/** 当前内存中的快照；启动时已读取并完成旧键迁移。 */
	readonly snapshot: SessionSnapshot;

	setTabs(tabs: readonly SnapshotTab[], activeTabId: string | undefined): void;
	/** 采集一次工作集：补齐磁盘 mtime、生成备份、裁剪容量后落盘。 */
	capture(sessions: readonly CapturedSession[]): Promise<void>;
	getScrollTop(tabId: string): number;
	setScrollTop(tabId: string, scrollTop: number): void;
	/** 启动后需要检查外部修改的编辑器。 */
	collectExternalCandidates(): readonly SnapshotEditor[];
	/** 逐个 stat 磁盘文件，返回启动后被外部修改的未保存文件。 */
	findExternallyChanged(editors: readonly SnapshotEditor[]): Promise<readonly string[]>;
	/** `files.hotExit` 为 `off` 时不恢复未保存内容。 */
	isHotExitEnabled(): boolean;
	flush(): Promise<void>;
}

export class SessionService extends Disposable implements ISessionService {
	declare readonly _serviceBrand: undefined;

	private _snapshot: SessionSnapshot = createEmptySnapshot();
	private captureQueue: Promise<void> = Promise.resolve();
	private loaded = false;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	get snapshot(): SessionSnapshot {
		this.ensureLoaded();
		return this._snapshot;
	}

	setTabs(tabs: readonly SnapshotTab[], activeTabId: string | undefined): void {
		this.ensureLoaded();
		this._snapshot = { ...this._snapshot, tabs, activeTabId };
		this.store();
	}

	capture(sessions: readonly CapturedSession[]): Promise<void> {
		this.captureQueue = this.captureQueue
			.then(() => this.captureNow(sessions))
			.catch(error => console.warn('[SideX] 保存会话快照失败', error));
		return this.captureQueue;
	}

	getScrollTop(tabId: string): number {
		return this.snapshot.scrollTops[tabId] ?? 0;
	}

	setScrollTop(tabId: string, scrollTop: number): void {
		this.ensureLoaded();
		const current = this._snapshot.scrollTops[tabId];
		const next = scrollTop > 0 ? scrollTop : undefined;
		if (current === next) {
			return;
		}
		const scrollTops = { ...this._snapshot.scrollTops };
		if (next === undefined) {
			delete scrollTops[tabId];
		} else {
			scrollTops[tabId] = next;
		}
		this._snapshot = { ...this._snapshot, scrollTops };
		this.store();
	}

	collectExternalCandidates(): readonly SnapshotEditor[] {
		const snapshot = this.snapshot;
		return collectExternalCandidates(snapshot, new Set(snapshot.tabs.map(tab => tab.id)));
	}

	async findExternallyChanged(editors: readonly SnapshotEditor[]): Promise<readonly string[]> {
		const mtimes = new Map<string, number | undefined>();
		await Promise.all(editors.map(async editor => {
			try {
				mtimes.set(editor.resource, (await this.fileService.stat(URI.parse(editor.resource))).mtime);
			} catch {
				mtimes.set(editor.resource, undefined);
			}
		}));
		return diffExternalChanges(editors, mtimes);
	}

	isHotExitEnabled(): boolean {
		return this.configurationService.getValue<string>('files.hotExit') !== HotExitConfiguration.OFF;
	}

	flush(): Promise<void> {
		return this.storageService.flush(WillSaveStateReason.SHUTDOWN);
	}

	private async captureNow(sessions: readonly CapturedSession[]): Promise<void> {
		this.ensureLoaded();
		const resources = new Set<string>();
		for (const session of sessions) {
			for (const editor of session.editors) {
				if (editor.dirty && editor.resource && !isUntitledResource(editor.resource)) {
					resources.add(editor.resource);
				}
			}
		}

		const diskMtimes = new Map<string, number>();
		await Promise.all([...resources].map(async resource => {
			try {
				diskMtimes.set(resource, (await this.fileService.stat(URI.parse(resource))).mtime);
			} catch {
				// 文件已删除时没有磁盘时间；备份仍然保留，仅跳过外部修改检测。
			}
		}));

		this._snapshot = buildSnapshot({ sessions, diskMtimes }, this._snapshot, Date.now());
		this.store();
	}

	private store(): void {
		this.storageService.store(
			SESSION_SNAPSHOT_KEY,
			serializeSnapshot(this._snapshot),
			StorageScope.PROFILE,
			StorageTarget.MACHINE
		);
	}

	private ensureLoaded(): void {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		this._snapshot = this.load();
	}

	private load(): SessionSnapshot {
		const raw = this.storageService.get(SESSION_SNAPSHOT_KEY, StorageScope.PROFILE);
		const stored = parseSnapshot(raw);
		if (stored) {
			return pruneBackups(stored);
		}
		if (raw) {
			console.warn('[SideX] 会话快照损坏，已清空');
		}

		const legacyScrolls: Record<string, string> = {};
		const legacyKeys: string[] = [];
		for (const key of this.storageService.keys(StorageScope.PROFILE, StorageTarget.MACHINE)) {
			if (!key.startsWith(LEGACY_SCROLL_PREFIX)) {
				continue;
			}
			const value = this.storageService.get(key, StorageScope.PROFILE);
			if (value !== undefined) {
				legacyScrolls[key] = value;
			}
			legacyKeys.push(key);
		}

		const migrated = migrateLegacySnapshot({
			tabs: this.storageService.get(LEGACY_TABS_KEY, StorageScope.PROFILE),
			sessions: this.storageService.get(LEGACY_SESSIONS_KEY, StorageScope.PROFILE),
			backups: this.storageService.get(LEGACY_BACKUPS_KEY, StorageScope.PROFILE),
			scrolls: legacyScrolls
		});

		for (const key of [LEGACY_TABS_KEY, LEGACY_SESSIONS_KEY, LEGACY_BACKUPS_KEY, ...legacyKeys]) {
			this.storageService.remove(key, StorageScope.PROFILE);
		}
		if (!migrated) {
			return createEmptySnapshot();
		}

		// 旧键已删除，先落盘再返回，避免中途退出丢失迁移结果。
		this._snapshot = pruneBackups(migrated);
		this.store();
		return this._snapshot;
	}
}

registerSingleton(ISessionService, SessionService, InstantiationType.Delayed);
