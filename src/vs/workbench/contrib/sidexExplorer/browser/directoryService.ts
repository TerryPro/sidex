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

export const IDirectoryService = createDecorator<IDirectoryService>('sidexDirectoryService');

export interface IDirectoryService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;
	readonly onDidChangeDrives: Event<void>;
	/** 用户点击某个目录标签（包括已经处于激活状态的标签），用于把主区域切回该标签的文件列表。 */
	readonly onDidActivateTab: Event<string>;

	readonly tabs: readonly DirectoryTab[];
	readonly activeTab: DirectoryTab | undefined;
	readonly drives: readonly SideXDriveInfo[];
	readonly drivesError: string | undefined;
	readonly activeLocation: string;

	getTab(id: string): DirectoryTab | undefined;

	initialize(): Promise<void>;

	addTab(location?: string): DirectoryTab;
	closeTab(id: string): void;
	activateTab(id: string): void;

	navigate(location: string): void;
	goBack(): void;
	goForward(): void;
	goUp(): void;
	refresh(): void;

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

	private readonly _onDidActivateTab = this._register(new Emitter<string>());
	readonly onDidActivateTab = this._onDidActivateTab.event;

	private _tabs: DirectoryTab[] = [];
	private _activeTabId: string | undefined;
	private _drives: SideXDriveInfo[] = [];
	private _drivesError: string | undefined;
	private _tabCounter = 0;
	private _initialized = false;

	constructor(
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService
	) {
		super();
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

		if (!this._tabs.length) {
			this.addTab('');
		} else {
			this._retitleTabs();
			this._onDidChange.fire();
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
		this._onDidActivateTab.fire(tab.id);
		this._onDidChange.fire();
		return tab;
	}

	closeTab(id: string): void {
		const index = this._tabs.findIndex(tab => tab.id === id);
		if (index < 0) {
			return;
		}

		const wasActive = this._activeTabId === id;
		this._tabs = this._tabs.filter(tab => tab.id !== id);

		if (!this._tabs.length) {
			this._activeTabId = undefined;
			this.addTab('');
			return;
		}

		if (wasActive) {
			this._activeTabId = this._tabs[Math.min(index, this._tabs.length - 1)].id;
		}
		this._onDidChange.fire();
	}

	activateTab(id: string): void {
		if (!this._tabs.some(tab => tab.id === id)) {
			return;
		}
		const changed = this._activeTabId !== id;
		this._activeTabId = id;
		// 即使点击的是当前标签，也要通知界面把主区域切回该标签的文件列表。
		this._onDidActivateTab.fire(id);
		if (changed) {
			this._onDidChange.fire();
		}
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

		const history = tab.history.slice(0, tab.historyIndex + 1);
		history.push(normalized);
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
	}

	private _retitleTabs(): void {
		this._tabs = this._tabs.map(tab => ({ ...tab, title: this.titleForLocation(tab.location) }));
	}
}

registerSingleton(IDirectoryService, DirectoryService, InstantiationType.Delayed);
