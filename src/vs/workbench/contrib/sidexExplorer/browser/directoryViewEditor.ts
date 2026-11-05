/*---------------------------------------------------------------------------------------------
 *  SideX — 主区域「文件列表」编辑器
 *
 *  「此电脑」显示驱动器磁贴，普通目录显示资源管理器风格的详细信息列表。
 *
 *  工作台的编辑器组对同一类型的编辑器只会实例化一个 EditorPane，因此这里在
 *  面板内部按目录标签维护多套独立视图，各自保留内容与滚动位置。
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, Dimension, EventType, reset } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ISideXExplorerService, SideXDriveInfo, SideXExplorerEntry } from '../../../../platform/sidex/common/sidexExplorerService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IDirectoryService } from './directoryService.js';
import { DirectoryViewEditorInput } from './directoryViewEditorInput.js';
import { driveIconSvg } from './explorerIcons.js';

/** 一个目录标签对应的独立视图，切换标签时保留内容与滚动位置。 */
interface DirectoryTabView {
	readonly tabId: string;
	readonly container: HTMLElement;
	readonly content: HTMLElement;
	readonly scrollable: DomScrollableElement;
	readonly renderDisposables: DisposableStore;
	renderedLocation: string | undefined;
	renderedRefreshToken: number;
	requestId: number;
}

export class DirectoryViewEditor extends EditorPane {

	static readonly ID = 'workbench.editor.sidexDirectoryView';

	private viewsRoot: HTMLElement | undefined;
	private readonly views = new Map<string, DirectoryTabView>();
	private readonly savedScrollTops = new Map<string, number>();
	private activeTabId: string | undefined;
	private readonly viewDisposables = this._register(new DisposableStore());
	private contextMenu: HTMLElement | undefined;
	private copiedPath: string | undefined;
	private sortKey: 'name' | 'modified' | 'type' | 'size' = 'name';
	private sortAscending = true;
	private readonly columnWidths = [260, 170, 130, 110];
	private static readonly PAGE_SIZE = 300;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(DirectoryViewEditor.ID, group, telemetryService, themeService, storageService);

		this.restoreViewPreferences();

		this.viewDisposables.add(this.directoryService.onDidChange(() => this.onDirectoryChange()));
		this.viewDisposables.add(this.directoryService.onDidChangeDrives(() => this.onDrivesChange()));
		// 文件图标主题切换后重新按新主题渲染列表。
		this.viewDisposables.add(this.themeService.onDidFileIconThemeChange(() => this.onFileIconThemeChange()));
	}

	private get activeView(): DirectoryTabView | undefined {
		return this.activeTabId ? this.views.get(this.activeTabId) : undefined;
	}

	protected createEditor(parent: HTMLElement): void {
		// show-file-icons 是文件图标主题样式的生效前提。
		this.viewsRoot = $('.sidex-directory-views.show-file-icons');
		parent.appendChild(this.viewsRoot);
	}

	override layout(_dimension: Dimension): void {
		this.activeView?.scrollable.scanDomNode();
	}

	override async setInput(
		input: DirectoryViewEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		this.activeTabId = this.directoryService.activeTab?.id;
		await super.setInput(input, options, context, token);
		await this.activateView(this.activeTabId, true);
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (!visible) {
			this.captureScrollPositions();
		}
	}

	override clearInput(): void {
		// 编辑器被其他类型的编辑器替换时，先把滚动位置记下来，DOM 移除后再恢复。
		this.captureScrollPositions();
		this.activeTabId = undefined;
		for (const view of this.views.values()) {
			view.container.style.display = 'none';
		}
		super.clearInput();
	}

	override dispose(): void {
		for (const view of this.views.values()) {
			view.renderDisposables.dispose();
			view.scrollable.dispose();
		}
		this.views.clear();
		this.savedScrollTops.clear();
		super.dispose();
	}

	private captureScrollPositions(): void {
		for (const view of this.views.values()) {
			if (view.container.style.display === 'none') {
				continue;
			}
			const scrollTop = view.scrollable.getScrollPosition().scrollTop;
			if (scrollTop > 0) {
				this.savedScrollTops.set(view.tabId, scrollTop);
			} else {
				this.savedScrollTops.delete(view.tabId);
			}
		}
	}

	private ensureView(tabId: string): DirectoryTabView {
		const existing = this.views.get(tabId);
		if (existing) {
			return existing;
		}

		const container = $('.sidex-directory-view');
		const content = $('.sidex-directory-content');
		const scrollable = new DomScrollableElement(content, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Visible,
			verticalScrollbarSize: 10,
			useShadows: false
		});
		const scrollableNode = scrollable.getDomNode();
		scrollableNode.classList.add('sidex-directory-scrollable');
		append(container, scrollableNode);
		this.viewsRoot?.appendChild(container);

		const view: DirectoryTabView = {
			tabId,
			container,
			content,
			scrollable,
			renderDisposables: new DisposableStore(),
			renderedLocation: undefined,
			renderedRefreshToken: -1,
			requestId: 0
		};
		this.views.set(tabId, view);
		return view;
	}

	/** 切换当前显示的目录视图；同一编辑器标签内完成，不新建编辑器标签。 */
	private async activateView(tabId: string | undefined, restoreScroll: boolean): Promise<void> {
		this.activeTabId = tabId;
		for (const [otherTabId, view] of this.views) {
			view.container.style.display = otherTabId === tabId ? '' : 'none';
		}
		if (!tabId) {
			return;
		}

		const view = this.ensureView(tabId);
		view.scrollable.scanDomNode();

		const tab = this.directoryService.getTab(tabId);
		if (tab && tab.location === view.renderedLocation && tab.refreshToken === view.renderedRefreshToken) {
			// 内容已是最新，复用已有 DOM，并恢复被其他编辑器遮挡时记录的滚动位置。
			if (restoreScroll) {
				const persisted = Number(this.storageService.get(`sidex.directory.scroll:${tabId}`, StorageScope.PROFILE) ?? '0');
				const scrollTop = this.savedScrollTops.get(tabId) ?? persisted;
				this.savedScrollTops.delete(tabId);
				if (scrollTop) {
					view.scrollable.setScrollPosition({ scrollTop });
				}
			}
			return;
		}

		this.savedScrollTops.delete(tabId);
		await this.reload(view);
	}

	private onDirectoryChange(): void {
		const tabIds = new Set(this.directoryService.tabs.map(tab => tab.id));
		for (const [tabId, view] of [...this.views]) {
			if (!tabIds.has(tabId)) {
				this.views.delete(tabId);
				this.savedScrollTops.delete(tabId);
				view.renderDisposables.dispose();
				view.scrollable.dispose();
				view.container.remove();
			}
		}

		// 目录标签切换时，同一个文件列表编辑器切换到对应标签的缓存视图。
		const nextTabId = this.directoryService.activeTab?.id;
		if (this.activeTabId !== nextTabId) {
			// 编辑器面板已被文件编辑器替换时，等重新 setInput 再切换视图。
			if (!this.input) {
				return;
			}
			this.captureScrollPositions();
			void this.activateView(nextTabId, true);
			return;
		}

		const view = this.activeView;
		if (!view) {
			return;
		}

		const tab = this.directoryService.getTab(view.tabId);
		if (!tab) {
			return;
		}

		// 只有内容真正变化时才重绘，切换标签本身不会影响其他视图。
		if (tab.location === view.renderedLocation && tab.refreshToken === view.renderedRefreshToken) {
			return;
		}
		void this.reload(view);
	}

	private onDrivesChange(): void {
		for (const view of this.views.values()) {
			view.renderedRefreshToken = -1;
		}
		const view = this.activeView;
		if (view) {
			void this.reload(view);
		}
	}

	private onFileIconThemeChange(): void {
		for (const view of this.views.values()) {
			view.renderedRefreshToken = -1;
		}
		const view = this.activeView;
		if (view) {
			void this.reload(view);
		}
	}

	private async reload(view: DirectoryTabView): Promise<void> {
		const currentRequest = ++view.requestId;
		const tab = this.directoryService.getTab(view.tabId);
		const location = tab?.location ?? '';
		view.renderedLocation = tab ? tab.location : undefined;
		view.renderedRefreshToken = tab ? tab.refreshToken : -1;

		view.renderDisposables.clear();
		reset(view.content);
		if (!location) {
			this.renderThisPc(view);
			view.scrollable.scanDomNode();
			return;
		}

		const loading = append(view.content, $('.sidex-directory-status'));
		loading.textContent = localize('sidex.directory.loading', '正在加载…');
		view.scrollable.scanDomNode();

		try {
			const entries = await this.explorerService.readDirectory(location);
			if (currentRequest !== view.requestId) {
				return;
			}
			reset(view.content);
			this.renderDirectory(view, location, entries);
			view.scrollable.scanDomNode();
		} catch (error) {
			if (currentRequest !== view.requestId) {
				return;
			}
			reset(view.content);
			const message = append(view.content, $('.sidex-directory-status'));
			message.textContent = localize('sidex.directory.loadFailed', '无法打开此位置：{0}', error instanceof Error ? error.message : String(error));
			view.scrollable.scanDomNode();
		}
	}

	private renderThisPc(view: DirectoryTabView): void {
		const section = append(view.content, $('.sidex-drive-section'));

		const header = append(section, $('div.sidex-drive-section-header'));
		header.textContent = localize('sidex.drives.devices', '设备和驱动器');

		const grid = append(section, $('div.sidex-drive-grid'));
		const drives = this.directoryService.drives;

		if (!drives.length) {
			const empty = append(grid, $('.sidex-drive-empty'));
			empty.textContent = this.directoryService.drivesError
				? localize('sidex.drives.loadFailed', '读取驱动器失败：{0}', this.directoryService.drivesError)
				: localize('sidex.drives.empty', '未检测到驱动器');
			return;
		}

		for (const drive of drives) {
			this.renderDriveTile(view, grid, drive);
		}
	}

	private renderDriveTile(view: DirectoryTabView, parent: HTMLElement, drive: SideXDriveInfo): void {
		const tile = append(parent, $('div.sidex-drive-tile'));
		tile.setAttribute('role', 'button');
		tile.tabIndex = 0;

		const icon = append(tile, $('span.sidex-drive-tile-icon'));
		icon.innerHTML = driveIconSvg(drive.kind);

		const body = append(tile, $('div.sidex-drive-tile-body'));

		const name = append(body, $('div.sidex-drive-tile-name'));
		const label = drive.label || this.defaultDriveLabel(drive.kind);
		name.textContent = label ? `${label} (${drive.letter})` : drive.letter;

		const bar = append(body, $('div.sidex-drive-capacity'));
		const used = append(bar, $('div.sidex-drive-capacity-used'));
		const ratio = drive.totalBytes > 0 ? (drive.totalBytes - drive.freeBytes) / drive.totalBytes : 0;
		used.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;

		const detail = append(body, $('div.sidex-drive-capacity-label'));
		detail.textContent = drive.totalBytes > 0
			? localize('sidex.drives.capacity', '{0} 可用，共 {1}', formatBytes(drive.freeBytes), formatBytes(drive.totalBytes))
			: localize('sidex.drives.capacityUnknown', '容量信息不可用');

		const open = () => this.directoryService.navigate(drive.path);
		view.renderDisposables.add(addDisposableListener(tile, EventType.CLICK, open));
		view.renderDisposables.add(addDisposableListener(tile, EventType.KEY_DOWN, event => {
			if (event.key === 'Enter') {
				open();
			}
		}));
	}

	private restoreViewPreferences(): void {
		const sort = this.storageService.get('sidex.directory.sort', StorageScope.PROFILE);
		if (sort) {
			const [key, direction] = sort.split(':');
			if (key === 'name' || key === 'modified' || key === 'type' || key === 'size') {
				this.sortKey = key;
				this.sortAscending = direction !== 'desc';
			}
		}
		const widths = this.storageService.get('sidex.directory.columnWidths', StorageScope.PROFILE);
		if (widths) {
			const parsed = widths.split(',').map(Number);
			if (parsed.length === 4 && parsed.every(value => Number.isFinite(value) && value > 40)) {
				parsed.forEach((value, index) => {
					this.columnWidths[index] = value;
				});
			}
		}
	}

	private persistViewPreferences(): void {
		this.storageService.store('sidex.directory.sort', `${this.sortKey}:${this.sortAscending ? 'asc' : 'desc'}`, StorageScope.PROFILE, StorageTarget.MACHINE);
		this.storageService.store('sidex.directory.columnWidths', this.columnWidths.join(','), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private sortEntries(entries: readonly SideXExplorerEntry[]): SideXExplorerEntry[] {
		const factor = this.sortAscending ? 1 : -1;
		return [...entries].sort((a, b) => {
			if (a.isDir !== b.isDir) {
				return a.isDir ? -1 : 1;
			}
			switch (this.sortKey) {
				case 'modified':
					return (a.modified - b.modified) * factor;
				case 'size':
					return (a.size - b.size) * factor;
				case 'type': {
					const aType = a.isDir ? '' : a.name.slice(a.name.lastIndexOf('.') + 1);
					const bType = b.isDir ? '' : b.name.slice(b.name.lastIndexOf('.') + 1);
					return aType.localeCompare(bType) * factor;
				}
				default:
					return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * factor;
			}
		});
	}

	private addColumnWidths(container: HTMLElement): void {
		container.style.setProperty('--sidex-col-name', `${this.columnWidths[0]}px`);
		container.style.setProperty('--sidex-col-modified', `${this.columnWidths[1]}px`);
		container.style.setProperty('--sidex-col-type', `${this.columnWidths[2]}px`);
		container.style.setProperty('--sidex-col-size', `${this.columnWidths[3]}px`);
	}

	private renderDirectory(view: DirectoryTabView, location: string, entries: readonly SideXExplorerEntry[]): void {
		const query = this.directoryService.searchQuery.toLowerCase();
		const filtered = query ? entries.filter(entry => entry.name.toLowerCase().includes(query)) : entries;
		const sorted = this.sortEntries(filtered);

		this.addColumnWidths(view.content);

		const header = append(view.content, $('div.sidex-file-list-header'));
		const columns: Array<{ key: 'name' | 'modified' | 'type' | 'size'; label: string }> = [
			{ key: 'name', label: localize('sidex.fileList.name', '名称') },
			{ key: 'modified', label: localize('sidex.fileList.modified', '修改日期') },
			{ key: 'type', label: localize('sidex.fileList.type', '类型') },
			{ key: 'size', label: localize('sidex.fileList.size', '大小') }
		];
		columns.forEach((column, index) => {
			const cell = append(header, $('span.sidex-file-list-column'));
			cell.textContent = column.label;
			if (this.sortKey === column.key) {
				cell.textContent = `${column.label} ${this.sortAscending ? '↑' : '↓'}`;
			}
			cell.addEventListener('click', () => {
				if (this.sortKey === column.key) {
					this.sortAscending = !this.sortAscending;
				} else {
					this.sortKey = column.key;
					this.sortAscending = true;
				}
				this.persistViewPreferences();
				void this.reload(view);
			});
			const resizer = append(cell, $('span.sidex-column-resizer'));
			resizer.addEventListener('pointerdown', (event: PointerEvent) => {
				event.preventDefault();
				event.stopPropagation();
				const startX = event.clientX;
				const startWidth = this.columnWidths[index];
				const move = (moveEvent: PointerEvent) => {
					this.columnWidths[index] = Math.max(60, startWidth + moveEvent.clientX - startX);
					this.addColumnWidths(view.content);
				};
				const up = () => {
					window.removeEventListener('pointermove', move);
					window.removeEventListener('pointerup', up);
					this.persistViewPreferences();
				};
				window.addEventListener('pointermove', move);
				window.addEventListener('pointerup', up);
			});
		});

		const list = append(view.content, $('div.sidex-file-list'));
		list.addEventListener('contextmenu', event => this.showContextMenu(event, view, location));

		if (!sorted.length) {
			const empty = append(list, $('.sidex-file-list-empty'));
			empty.textContent = localize('sidex.fileList.empty', '此文件夹为空');
			return;
		}

		const rows = new Map<string, HTMLElement>();
		const renderBatch = (start: number) => {
			const end = Math.min(sorted.length, start + DirectoryViewEditor.PAGE_SIZE);
			for (let index = start; index < end; index++) {
				const entry = sorted[index];
				rows.set(entry.path, this.renderFileRow(view, list, location, entry));
			}
			if (end < sorted.length) {
				const more = append(list, $('button.sidex-file-list-more'));
				more.textContent = localize('sidex.fileList.loadMore', '显示更多（剩余 {0} 项）', sorted.length - end);
				more.addEventListener('click', () => {
					more.remove();
					renderBatch(end);
				});
			}
		};
		renderBatch(0);

		const selection = this.directoryService.getSelection(view.tabId);
		if (selection) {
			rows.get(selection.path)?.classList.add('selected');
		}

		view.content.setAttribute('data-location', location);

		view.renderDisposables.add(view.scrollable.onScroll(() => {
			const scrollTop = String(view.scrollable.getScrollPosition().scrollTop);
			this.storageService.store(`sidex.directory.scroll:${view.tabId}`, scrollTop, StorageScope.PROFILE, StorageTarget.MACHINE);
		}));
	}

	private renderFileRow(view: DirectoryTabView, list: HTMLElement, location: string, entry: SideXExplorerEntry): HTMLElement {
		const row = append(list, $('div.sidex-file-row'));
		row.tabIndex = 0;
		row.setAttribute('data-path', entry.path);
		row.draggable = true;

		const nameCell = append(row, $('span.sidex-file-name'));
		const icon = append(nameCell, $('span.sidex-file-icon'));
		this.applyFileIcon(icon, entry);
		const text = append(nameCell, $('span.sidex-file-name-text'));
		text.textContent = entry.name;

		const modified = append(row, $('span.sidex-file-cell'));
		modified.textContent = entry.modified ? new Date(entry.modified * 1000).toLocaleString() : '';

		const type = append(row, $('span.sidex-file-cell'));
		type.textContent = entry.isDir
			? localize('sidex.fileList.folder', '文件夹')
			: (entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toUpperCase() + ' 文件' : localize('sidex.fileList.file', '文件'));

		const size = append(row, $('span.sidex-file-cell'));
		size.textContent = entry.isDir ? '' : formatBytes(entry.size);

		const open = () => {
			if (entry.isDir) {
				this.directoryService.navigate(entry.path);
			} else {
				void this.editorService.openEditor({
					resource: URI.file(entry.path),
					options: { pinned: true }
				});
			}
		};

		view.renderDisposables.add(addDisposableListener(row, EventType.CLICK, () => {
			view.content.querySelectorAll('.sidex-file-row.selected').forEach(element => element.classList.remove('selected'));
			row.classList.add('selected');
			this.directoryService.select({
				path: entry.path,
				name: entry.name,
				isDir: entry.isDir,
				size: entry.size,
				modified: entry.modified
			});
		}));

		view.renderDisposables.add(addDisposableListener(row, EventType.DBLCLICK, open));
		view.renderDisposables.add(addDisposableListener(row, EventType.KEY_DOWN, event => {
			if (event.key === 'Enter') {
				open();
			}
		}));
		view.renderDisposables.add(addDisposableListener(row, EventType.CONTEXT_MENU, event => this.showContextMenu(event, view, location, entry)));

		row.addEventListener('dragstart', event => {
			event.dataTransfer?.setData('text/plain', entry.path);
			event.dataTransfer?.setDragImage(row, 12, 12);
		});
		if (entry.isDir) {
			row.addEventListener('dragover', event => {
				event.preventDefault();
				row.classList.add('drop-target');
			});
			row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
			row.addEventListener('drop', event => {
				event.preventDefault();
				row.classList.remove('drop-target');
				const source = event.dataTransfer?.getData('text/plain');
				if (source && source !== entry.path) {
					void this.moveEntry(source, entry.path);
				}
			});
		}

		return row;
	}

	private showContextMenu(event: MouseEvent, view: DirectoryTabView, location: string, entry?: SideXExplorerEntry): void {
		event.preventDefault();
		event.stopPropagation();
		this.hideContextMenu();

		const menu = $('div.sidex-context-menu');
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		menu.style.visibility = 'hidden';
		const host = document.querySelector('.monaco-workbench') ?? document.body;
		host.appendChild(menu);
		this.contextMenu = menu;

		const addItem = (label: string, run: () => void, enabled = true) => {
			const item = append(menu, $('div.sidex-context-menu-item'));
			item.textContent = label;
			if (!enabled) {
				item.classList.add('disabled');
				return;
			}
			item.addEventListener('mousedown', event => {
				event.preventDefault();
				event.stopPropagation();
				this.hideContextMenu();
				run();
			});
		};

		if (entry) {
			addItem(localize('sidex.menu.open', '打开'), () => {
				if (entry.isDir) {
					this.directoryService.navigate(entry.path);
				} else {
					void this.editorService.openEditor({ resource: URI.file(entry.path), options: { pinned: true } });
				}
			});
			addItem(localize('sidex.menu.rename', '重命名'), () => void this.renameEntry(entry));
			addItem(localize('sidex.menu.copy', '复制'), () => {
				this.copiedPath = entry.path;
				this.notificationService.info(localize('sidex.copy.done', '已复制“{0}”', entry.name));
			});
			addItem(localize('sidex.menu.trash', '移到回收站'), () => void this.deleteEntry(entry));
			addItem(localize('sidex.menu.copyPath', '复制路径'), () => void navigator.clipboard.writeText(entry.path));
		} else {
			addItem(localize('sidex.menu.newFile', '新建文件'), () => void this.createEntry(location, false));
			addItem(localize('sidex.menu.newFolder', '新建文件夹'), () => void this.createEntry(location, true));
			addItem(localize('sidex.menu.paste', '粘贴'), () => void this.pasteEntry(location), !!this.copiedPath);
			addItem(localize('sidex.menu.refresh', '刷新'), () => this.directoryService.refresh());
		}

		const rect = menu.getBoundingClientRect();
		if (rect.right > window.innerWidth) {
			menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
		}
		if (rect.bottom > window.innerHeight) {
			menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
		}
		menu.style.visibility = '';

		window.setTimeout(() => {
			const dismiss = (dismissEvent: MouseEvent) => {
				if (!menu.contains(dismissEvent.target as Node)) {
					this.hideContextMenu();
				}
			};
			window.addEventListener('mousedown', dismiss, { once: true });
			window.addEventListener('blur', () => this.hideContextMenu(), { once: true });
		}, 0);
	}

	private hideContextMenu(): void {
		this.contextMenu?.remove();
		this.contextMenu = undefined;
	}

	private async createEntry(location: string, folder: boolean): Promise<void> {
		const name = await this.quickInputService.input({
			prompt: folder
				? localize('sidex.newFolder.prompt', '新建文件夹名称')
				: localize('sidex.newFile.prompt', '新建文件名称'),
			placeHolder: folder ? 'New folder' : 'untitled.txt'
		});
		if (!name) {
			return;
		}
		const target = `${location.endsWith('\\') ? location : `${location}\\`}${name}`;
		try {
			if (folder) {
				await this.explorerService.createFolder(target);
			} else {
				await this.explorerService.createFile(target);
			}
			this.directoryService.refresh();
		} catch (error) {
			this.notificationService.error(String(error));
		}
	}

	private async renameEntry(entry: SideXExplorerEntry): Promise<void> {
		const name = await this.quickInputService.input({
			prompt: localize('sidex.rename.prompt', '重命名'),
			value: entry.name
		});
		if (!name || name === entry.name) {
			return;
		}
		const parent = entry.path.slice(0, entry.path.lastIndexOf('\\'));
		try {
			await this.explorerService.rename(entry.path, `${parent}\\${name}`);
			this.directoryService.refresh();
		} catch (error) {
			this.notificationService.error(String(error));
		}
	}

	private async deleteEntry(entry: SideXExplorerEntry): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: localize('sidex.trash.confirm', '将“{0}”移到回收站？', entry.name),
			primaryButton: localize('sidex.trash.action', '移到回收站')
		});
		if (!confirmed) {
			return;
		}
		try {
			await this.explorerService.moveToTrash(entry.path);
			this.directoryService.refresh();
		} catch (error) {
			this.notificationService.error(String(error));
		}
	}

	private async pasteEntry(targetDirectory: string): Promise<void> {
		const source = this.copiedPath;
		if (!source) {
			return;
		}
		const name = source.slice(source.lastIndexOf('\\') + 1);
		const destination = `${targetDirectory.endsWith('\\') ? targetDirectory : `${targetDirectory}\\`}${name}`;
		try {
			await this.explorerService.copy(source, destination, true);
			this.directoryService.refresh();
		} catch (error) {
			this.notificationService.error(String(error));
		}
	}

	private async moveEntry(source: string, targetDirectory: string): Promise<void> {
		const name = source.slice(source.lastIndexOf('\\') + 1);
		const destination = `${targetDirectory.endsWith('\\') ? targetDirectory : `${targetDirectory}\\`}${name}`;
		if (source === destination) {
			return;
		}
		try {
			await this.explorerService.rename(source, destination);
			this.directoryService.refresh();
		} catch (error) {
			this.notificationService.error(String(error));
		}
	}

	/** 优先使用文件图标主题；没有配置图标主题时回退到 codicon。 */
	private applyFileIcon(element: HTMLElement, entry: SideXExplorerEntry): void {
		const fileIconTheme = this.themeService.getFileIconTheme();
		const hasThemeIcon = entry.isDir ? fileIconTheme.hasFolderIcons : fileIconTheme.hasFileIcons;
		if (hasThemeIcon) {
			for (const className of getIconClasses(
				this.modelService,
				this.languageService,
				URI.file(entry.path),
				entry.isDir ? FileKind.FOLDER : FileKind.FILE
			)) {
				element.classList.add(className);
			}
			return;
		}

		for (const className of ThemeIcon.asClassName(entry.isDir ? Codicon.folder : Codicon.file).split(' ')) {
			element.classList.add(className);
		}
	}

	private defaultDriveLabel(kind: string): string {
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
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / Math.pow(1024, index);
	const decimals = index >= 3 ? 1 : 0;
	return `${value.toFixed(decimals)} ${units[index]}`;
}
