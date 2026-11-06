/*---------------------------------------------------------------------------------------------
 *  SideX — 目录标签服务（阶段 1 骨架）
 *
 *  每个标签保存自己的当前位置与导航历史；切换标签时界面状态互不影响。
 *  目录内容与驱动器列表由 ISideXExplorerService 从 Rust 侧读取。
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISideXExplorerService, SideXDriveInfo } from '../../../../platform/sidex/common/sidexExplorerService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export interface DirectoryTab {
	readonly id: string;
	/** `''` 表示「此电脑」，其余为绝对路径 */
	readonly location: string;
	readonly title: string;
	readonly history: readonly string[];
	readonly historyIndex: number;
	/** 每次显式刷新递增，编辑器据此判断是否需要重新加载（位置不变时也能刷新）。 */
	readonly refreshToken: number;
}

/** 文件列表中被单击选中的项，用于右侧预览与属性栏。每个目录标签各存一份。 */
export interface DirectorySelection {
	readonly path: string;
	readonly name: string;
	readonly isDir: boolean;
	readonly size: number;
	readonly modified: number;
}

export const IDirectoryService = createDecorator<IDirectoryService>('sidexDirectoryService');

export interface IDirectoryService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;
	readonly onDidChangeDrives: Event<void>;
	readonly onDidChangeSelection: Event<void>;
	readonly onDidChangePlaces: Event<void>;

	readonly tabs: readonly DirectoryTab[];
	readonly activeTab: DirectoryTab | undefined;
	readonly drives: readonly SideXDriveInfo[];
	readonly drivesError: string | undefined;
	readonly activeLocation: string;

	/** 最近打开过的目录，最近使用的在前。 */
	readonly recentLocations: readonly string[];
	/** 收藏的目录；可固定显示在导航区域。 */
	readonly favorites: readonly string[];
	isFavorite(location: string): boolean;
	toggleFavorite(location: string): void;
	removeFavorite(location: string): void;
	removeRecent(location: string): void;

	getTab(id: string): DirectoryTab | undefined;

	/** 当前目录标签（或指定标签）的选中项。 */
	getSelection(tabId?: string): DirectorySelection | undefined;
	/** 当前目录标签（或指定标签）的全部选中路径。 */
	getSelectionPaths(tabId?: string): readonly string[];
	/** 单击文件列表项时调用；导航或刷新会清空选中项。 */
	select(entry: DirectorySelection, paths?: readonly string[]): void;
	/** 当前目录内的名称过滤词；空字符串表示不过滤。每个标签各存一份。 */
	readonly searchQuery: string;
	setSearch(query: string): void;

	initialize(): Promise<void>;

	addTab(location?: string): DirectoryTab;
	closeTab(id: string): void;
	activateTab(id: string): void;

	navigate(location: string): void;
	goBack(): void;
	goForward(): void;
	goUp(): void;
	refresh(): void;
	/** 只刷新指定标签的目录内容，不切换活动标签。 */
	refreshTab(tabId: string): void;

	canGoBack(): boolean;
	canGoForward(): boolean;
	canGoUp(): boolean;

	titleForLocation(location: string): string;
}

/** 把用户/系统给出的路径统一成资源管理器风格。 */
export function normalizeLocation(raw: string): string {
	const value = (raw ?? '').trim();
	if (!value) {
		return '';
	}
	let path = value.replace(/\//g, '\\');
	if (/^[A-Za-z]:$/.test(path)) {
		return `${path}\\`;
	}
	if (!/^[A-Za-z]:\\$/.test(path)) {
		path = path.replace(/\\+$/g, '');
	}
	return path;
}

/** 返回上一级；盘符根目录的上一级是「此电脑」。 */
export function parentLocation(location: string): string {
	const path = normalizeLocation(location).replace(/\\+$/, '');
	if (!path) {
		return '';
	}
	if (/^[A-Za-z]:$/.test(path)) {
		return '';
	}
	const index = path.lastIndexOf('\\');
	if (index <= 0) {
		return '';
	}
	const parent = path.slice(0, index);
	if (/^[A-Za-z]:$/.test(parent)) {
		return `${parent}\\`;
	}
	return parent;
}

function defaultDriveLabel(kind: string): string {
	switch (kind) {
		case 'fixed':
			return localize('sidex.drive.localDisk', '本地磁盘');
		case 'removable':
			return localize('sidex.drive.removableDisk', '可移动磁盘');
		case 'network':
			return localize('sidex.drive.networkDrive', '网络驱动器');
		case 'cdrom':
			return localize('sidex.drive.cdDrive', 'DVD 驱动器');
		default:
			return '';
	}
}

export class DirectoryService extends Disposable implements IDirectoryService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidChangeDrives = this._register(new Emitter<void>());
	readonly onDidChangeDrives = this._onDidChangeDrives.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	private readonly _onDidChangePlaces = this._register(new Emitter<void>());
	readonly onDidChangePlaces = this._onDidChangePlaces.event;

	private static readonly FAVORITES_KEY = 'sidex.directory.favorites';
	private static readonly RECENT_KEY = 'sidex.directory.recent';
	private static readonly MAX_RECENT = 12;

	private readonly _selectionByTab = new Map<string, DirectorySelection>();
	private readonly _selectionPathsByTab = new Map<string, string[]>();
	private readonly _searchByTab = new Map<string, string>();
	private _favorites: string[] = [];
	private _recent: string[] = [];
	private _tabs: DirectoryTab[] = [];
	private _activeTabId: string | undefined;
	private _drives: SideXDriveInfo[] = [];
	private _drivesError: string | undefined;
	private _tabCounter = 0;
	private _initialized = false;

	constructor(
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
	}

	private persistTabs(): void {
		const data = JSON.stringify({
			active: this._activeTabId,
			tabs: this._tabs.map(tab => ({
				id: tab.id,
				location: tab.location,
				history: tab.history,
				historyIndex: tab.historyIndex
			}))
		});
		this.storageService.store('sidex.directory.tabs', data, StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private restoreTabs(): boolean {
		const raw = this.storageService.get('sidex.directory.tabs', StorageScope.PROFILE);
		if (!raw) {
			return false;
		}
		try {
			const data = JSON.parse(raw) as {
				active?: string;
				tabs?: Array<{ id: string; location: string; history?: string[]; historyIndex?: number }>;
			};
			if (!data.tabs?.length) {
				return false;
			}
			this._tabs = data.tabs.map(tab => {
				const location = normalizeLocation(tab.location);
				return {
					id: tab.id,
					location,
					title: this.titleForLocation(location),
					history: tab.history?.length ? tab.history : [location],
					historyIndex: tab.historyIndex ?? 0,
					refreshToken: 0
				};
			});
			this._activeTabId = this._tabs.find(tab => tab.id === data.active)?.id ?? this._tabs[0].id;
			this._tabCounter = this._tabs.length;
			return true;
		} catch {
			return false;
		}
	}

	/** 当前目录内的名称过滤词；每个目录标签各存一份。 */
	get searchQuery(): string {
		return this._activeTabId ? this._searchByTab.get(this._activeTabId) ?? '' : '';
	}

	setSearch(query: string): void {
		const tabId = this._activeTabId;
		if (!tabId || (this._searchByTab.get(tabId) ?? '') === query) {
			return;
		}
		if (query) {
			this._searchByTab.set(tabId, query);
		} else {
			this._searchByTab.delete(tabId);
		}
		this._onDidChange.fire();
	}

	get recentLocations(): readonly string[] {
		return this._recent;
	}

	get favorites(): readonly string[] {
		return this._favorites;
	}

	isFavorite(location: string): boolean {
		const normalized = normalizeLocation(location).toLowerCase();
		return this._favorites.some(item => item.toLowerCase() === normalized);
	}

	toggleFavorite(location: string): void {
		const normalized = normalizeLocation(location);
		if (!normalized) {
			return;
		}
		if (this.isFavorite(normalized)) {
			this._favorites = this._favorites.filter(item => item.toLowerCase() !== normalized.toLowerCase());
		} else {
			this._favorites = [normalized, ...this._favorites];
		}
		this.persistPlaces();
		this._onDidChangePlaces.fire();
	}

	removeFavorite(location: string): void {
		const normalized = location.toLowerCase();
		const next = this._favorites.filter(item => item.toLowerCase() !== normalized);
		if (next.length === this._favorites.length) {
			return;
		}
		this._favorites = next;
		this.persistPlaces();
		this._onDidChangePlaces.fire();
	}

	removeRecent(location: string): void {
		const normalized = location.toLowerCase();
		const next = this._recent.filter(item => item.toLowerCase() !== normalized);
		if (next.length === this._recent.length) {
			return;
		}
		this._recent = next;
		this.persistPlaces();
		this._onDidChangePlaces.fire();
	}

	private restorePlaces(): void {
		try {
			const favorites = JSON.parse(this.storageService.get(DirectoryService.FAVORITES_KEY, StorageScope.PROFILE) ?? '[]');
			if (Array.isArray(favorites)) {
				this._favorites = favorites
					.filter((item): item is string => typeof item === 'string' && !!normalizeLocation(item))
					.map(item => normalizeLocation(item));
			}
		} catch {
			// 损坏的收藏数据忽略即可。
		}
		try {
			const recent = JSON.parse(this.storageService.get(DirectoryService.RECENT_KEY, StorageScope.PROFILE) ?? '[]');
			if (Array.isArray(recent)) {
				this._recent = recent
					.filter((item): item is string => typeof item === 'string' && !!normalizeLocation(item))
					.map(item => normalizeLocation(item))
					.slice(0, DirectoryService.MAX_RECENT);
			}
		} catch {
			// 损坏的最近记录忽略即可。
		}
	}

	private persistPlaces(): void {
		this.storageService.store(
			DirectoryService.FAVORITES_KEY,
			JSON.stringify(this._favorites),
			StorageScope.PROFILE,
			StorageTarget.MACHINE
		);
		this.storageService.store(
			DirectoryService.RECENT_KEY,
			JSON.stringify(this._recent),
			StorageScope.PROFILE,
			StorageTarget.MACHINE
		);
	}

	private recordRecent(location: string): void {
		const normalized = normalizeLocation(location);
		if (!normalized) {
			return;
		}
		const next = [normalized, ...this._recent.filter(item => item.toLowerCase() !== normalized.toLowerCase())];
		this._recent = next.slice(0, DirectoryService.MAX_RECENT);
		this.persistPlaces();
	}

	get tabs(): readonly DirectoryTab[] {
		return this._tabs;
	}

	get activeTab(): DirectoryTab | undefined {
		return this._tabs.find(tab => tab.id === this._activeTabId);
	}

	getTab(id: string): DirectoryTab | undefined {
		return this._tabs.find(tab => tab.id === id);
	}

	getSelection(tabId = this._activeTabId): DirectorySelection | undefined {
		return tabId ? this._selectionByTab.get(tabId) : undefined;
	}

	getSelectionPaths(tabId = this._activeTabId): readonly string[] {
		if (!tabId) {
			return [];
		}
		const paths = this._selectionPathsByTab.get(tabId);
		if (paths?.length) {
			return paths;
		}
		const primary = this._selectionByTab.get(tabId);
		return primary ? [primary.path] : [];
	}

	select(entry: DirectorySelection, paths?: readonly string[]): void {
		const tabId = this._activeTabId;
		if (!tabId) {
			return;
		}
		this._selectionByTab.set(tabId, entry);
		this._selectionPathsByTab.set(tabId, paths?.length ? [...paths] : [entry.path]);
		this._onDidChangeSelection.fire();
	}

	get drives(): readonly SideXDriveInfo[] {
		return this._drives;
	}

	get drivesError(): string | undefined {
		return this._drivesError;
	}

	get activeLocation(): string {
		return this.activeTab?.location ?? '';
	}

	async initialize(): Promise<void> {
		if (this._initialized) {
			return;
		}
		this._initialized = true;

		try {
			this._drives = await this.explorerService.listDrives();
			this._drivesError = undefined;
		} catch (error) {
			this._drives = [];
			this._drivesError = error instanceof Error ? error.message : String(error);
			console.error('[SideX] list_drives failed', error);
		}
		this._onDidChangeDrives.fire();
		this.restorePlaces();

		if (!this._tabs.length) {
			if (!this.restoreTabs()) {
				this.addTab('');
			} else {
				this._onDidChange.fire();
				this.persistTabs();
			}
		} else {
			this._retitleTabs();
			this._onDidChange.fire();
		}
		if (this.activeTab?.location) {
			this.recordRecent(this.activeTab.location);
		}
	}

	addTab(location = ''): DirectoryTab {
		const normalized = normalizeLocation(location);
		const tab: DirectoryTab = {
			id: `directory-tab-${++this._tabCounter}`,
			location: normalized,
			title: this.titleForLocation(normalized),
			history: [normalized],
			historyIndex: 0,
			refreshToken: 0
		};
		this._tabs = [...this._tabs, tab];
		this._activeTabId = tab.id;
		this.recordRecent(normalized);
		this._onDidChange.fire();
		this.persistTabs();
		return tab;
	}

	closeTab(id: string): void {
		const index = this._tabs.findIndex(tab => tab.id === id);
		if (index < 0) {
			return;
		}

		const wasActive = this._activeTabId === id;
		this._tabs = this._tabs.filter(tab => tab.id !== id);
		this._selectionByTab.delete(id);
		this._selectionPathsByTab.delete(id);
		this._searchByTab.delete(id);

		if (!this._tabs.length) {
			this._activeTabId = undefined;
			this.addTab('');
			return;
		}

		if (wasActive) {
			this._activeTabId = this._tabs[Math.min(index, this._tabs.length - 1)].id;
		}
		this._onDidChange.fire();
		this.persistTabs();
	}

	activateTab(id: string): void {
		if (!this._tabs.some(tab => tab.id === id)) {
			return;
		}
		// 点击已激活的标签不应改变主区域内容，因此只在真正切换时通知界面。
		if (this._activeTabId === id) {
			return;
		}
		this._activeTabId = id;
		this._onDidChange.fire();
		this.persistTabs();
	}

	navigate(location: string): void {
		const tab = this.activeTab;
		if (!tab) {
			this.addTab(location);
			return;
		}

		const normalized = normalizeLocation(location);
		if (normalized === tab.location) {
			this.refresh();
			return;
		}

		this._selectionByTab.delete(tab.id);
		this._selectionPathsByTab.delete(tab.id);
		this._searchByTab.delete(tab.id);
		const history = tab.history.slice(0, tab.historyIndex + 1);
		history.push(normalized);
		this.recordRecent(normalized);
		this._updateTab(tab.id, {
			location: normalized,
			title: this.titleForLocation(normalized),
			history,
			historyIndex: history.length - 1
		});
	}

	goBack(): void {
		const tab = this.activeTab;
		if (!tab || tab.historyIndex <= 0) {
			return;
		}
		const historyIndex = tab.historyIndex - 1;
		const location = tab.history[historyIndex];
		this._selectionByTab.delete(tab.id);
		this._selectionPathsByTab.delete(tab.id);
		this._searchByTab.delete(tab.id);
		this.recordRecent(location);
		this._updateTab(tab.id, {
			location,
			title: this.titleForLocation(location),
			historyIndex
		});
	}

	goForward(): void {
		const tab = this.activeTab;
		if (!tab || tab.historyIndex >= tab.history.length - 1) {
			return;
		}
		const historyIndex = tab.historyIndex + 1;
		const location = tab.history[historyIndex];
		this._selectionByTab.delete(tab.id);
		this._selectionPathsByTab.delete(tab.id);
		this._searchByTab.delete(tab.id);
		this.recordRecent(location);
		this._updateTab(tab.id, {
			location,
			title: this.titleForLocation(location),
			historyIndex
		});
	}

	goUp(): void {
		const tab = this.activeTab;
		if (!tab || !tab.location) {
			return;
		}
		this.navigate(parentLocation(tab.location));
	}

	refresh(): void {
		const tab = this.activeTab;
		if (!tab) {
			return;
		}
		this._updateTab(tab.id, { refreshToken: tab.refreshToken + 1 });
		// 刷新后文件可能已变化，让预览面板重新读取。
		this._onDidChangeSelection.fire();
	}

	refreshTab(tabId: string): void {
		const tab = this.getTab(tabId);
		if (!tab) {
			return;
		}
		this._updateTab(tab.id, { refreshToken: tab.refreshToken + 1 });
		this._onDidChangeSelection.fire();
	}

	canGoBack(): boolean {
		const tab = this.activeTab;
		return !!tab && tab.historyIndex > 0;
	}

	canGoForward(): boolean {
		const tab = this.activeTab;
		return !!tab && tab.historyIndex < tab.history.length - 1;
	}

	canGoUp(): boolean {
		return !!this.activeTab && !!this.activeTab.location;
	}

	titleForLocation(location: string): string {
		if (!location) {
			return localize('sidex.thisPc', '此电脑');
		}

		const normalized = normalizeLocation(location);
		const drive = this._drives.find(item => normalizeLocation(item.path).toLowerCase() === normalized.toLowerCase());
		if (drive) {
			const label = drive.label || defaultDriveLabel(drive.kind);
			return label ? `${label} (${drive.letter})` : drive.letter;
		}

		const root = /^([A-Za-z]:)\\$/.exec(normalized);
		if (root) {
			const letter = `${root[1].toUpperCase()}:`;
			const rootDrive = this._drives.find(item => item.letter.toUpperCase() === letter);
			const label = rootDrive?.label || defaultDriveLabel(rootDrive?.kind ?? '');
			return label ? `${label} (${letter})` : letter;
		}

		const parts = normalized.split('\\').filter(Boolean);
		return parts.length ? parts[parts.length - 1] : normalized;
	}

	private _updateTab(id: string, patch: Partial<DirectoryTab>): void {
		this._tabs = this._tabs.map(tab => (tab.id === id ? { ...tab, ...patch } : tab));
		this._onDidChange.fire();
		this.persistTabs();
	}

	private _retitleTabs(): void {
		this._tabs = this._tabs.map(tab => ({ ...tab, title: this.titleForLocation(tab.location) }));
	}
}

registerSingleton(IDirectoryService, DirectoryService, InstantiationType.Delayed);
