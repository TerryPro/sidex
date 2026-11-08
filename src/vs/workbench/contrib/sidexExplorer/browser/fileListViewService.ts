/*---------------------------------------------------------------------------------------------
 *  SideX — 文件列表的查看模式与排序状态
 *
 *  标题栏的「查看 / 排序」下拉与文件列表编辑器共用这一份状态：按目录标签保存，
 *  没有独立记录时回退到最近一次使用的默认值。
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { DEFAULT_FILE_VIEW_STATE, normalizeFileViewState, parseFileViewStates, type FileViewMode, type FileViewState } from '../common/fileListView.js';
import type { FileSortKey } from '../common/fileListSort.js';
import { IDirectoryService } from './directoryService.js';

export const IFileListViewService = createDecorator<IFileListViewService>('sidexFileListViewService');

export interface IFileListViewService {
	readonly _serviceBrand: undefined;

	/** 查看模式、排序或扩展名开关变化后触发。 */
	readonly onDidChange: Event<void>;

	/** 文件是否显示扩展名；只影响名称显示。 */
	readonly showExtensions: boolean;

	getViewState(tabId?: string): FileViewState;
	setViewState(patch: Partial<FileViewState>, tabId?: string): void;
	setViewMode(mode: FileViewMode): void;
	/** 选择排序键；同一键再次选择时保持当前方向。 */
	setSortKey(key: FileSortKey): void;
	setSortAscending(ascending: boolean): void;
	toggleShowExtensions(): void;
}

const SORT_STORAGE_KEY = 'sidex.directory.sort';
const STATES_STORAGE_KEY = 'sidex.directory.viewStates';
const DEFAULTS_STORAGE_KEY = 'sidex.directory.viewDefaults';
const EXTENSIONS_STORAGE_KEY = 'sidex.directory.showExtensions';

export class FileListViewService extends Disposable implements IFileListViewService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly viewStates = new Map<string, FileViewState>();
	private defaultViewState: FileViewState = DEFAULT_FILE_VIEW_STATE;
	private extensionsVisible = true;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IDirectoryService private readonly directoryService: IDirectoryService
	) {
		super();
		this.restore();
	}

	get showExtensions(): boolean {
		return this.extensionsVisible;
	}

	getViewState(tabId?: string): FileViewState {
		const id = tabId ?? this.directoryService.activeTab?.id;
		return (id ? this.viewStates.get(id) : undefined) ?? this.defaultViewState;
	}

	setViewState(patch: Partial<FileViewState>, tabId?: string): void {
		const id = tabId ?? this.directoryService.activeTab?.id;
		const next: FileViewState = { ...this.getViewState(id), ...patch };
		if (id) {
			this.viewStates.set(id, next);
		}
		this.defaultViewState = next;
		this.persist();
		this._onDidChange.fire();
	}

	setViewMode(mode: FileViewMode): void {
		this.setViewState({ viewMode: mode });
	}

	setSortKey(key: FileSortKey): void {
		const current = this.getViewState();
		this.setViewState({
			sortKey: key,
			sortAscending: current.sortKey === key ? current.sortAscending : true
		});
	}

	setSortAscending(ascending: boolean): void {
		this.setViewState({ sortAscending: ascending });
	}

	toggleShowExtensions(): void {
		this.extensionsVisible = !this.extensionsVisible;
		this.persist();
		this._onDidChange.fire();
	}

	private restore(): void {
		const legacy = this.storageService.get(SORT_STORAGE_KEY, StorageScope.PROFILE);
		if (legacy) {
			const [key, direction] = legacy.split(':');
			if (key === 'name' || key === 'modified' || key === 'type' || key === 'size') {
				this.defaultViewState = { ...this.defaultViewState, sortKey: key, sortAscending: direction !== 'desc' };
			}
		}
		const defaults = this.storageService.get(DEFAULTS_STORAGE_KEY, StorageScope.PROFILE);
		if (defaults) {
			try {
				this.defaultViewState = normalizeFileViewState(JSON.parse(defaults));
			} catch {
				// 损坏的默认值保持内置默认。
			}
		}
		const states = parseFileViewStates(this.storageService.get(STATES_STORAGE_KEY, StorageScope.PROFILE));
		for (const [tabId, state] of Object.entries(states)) {
			this.viewStates.set(tabId, state);
		}
		this.extensionsVisible = this.storageService.get(EXTENSIONS_STORAGE_KEY, StorageScope.PROFILE) !== 'false';
	}

	private persist(): void {
		const states: Record<string, FileViewState> = {};
		for (const [tabId, state] of this.viewStates) {
			states[tabId] = state;
		}
		this.storageService.store(STATES_STORAGE_KEY, JSON.stringify(states), StorageScope.PROFILE, StorageTarget.MACHINE);
		this.storageService.store(DEFAULTS_STORAGE_KEY, JSON.stringify(this.defaultViewState), StorageScope.PROFILE, StorageTarget.MACHINE);
		this.storageService.store(EXTENSIONS_STORAGE_KEY, String(this.extensionsVisible), StorageScope.PROFILE, StorageTarget.MACHINE);
	}
}
