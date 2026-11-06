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
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
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
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
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
import { FILE_LIST_FOCUS_CONTEXT, IFileListCommandHost, setActiveFileListHost } from './fileListCommands.js';
import { fileName, IFileOperationService, joinPath, parentDirectory, SIDEX_FILES_MIME } from './fileOperationService.js';
import { IThumbnailService } from './thumbnailService.js';

/** 一个目录标签对应的独立视图，切换标签时保留内容与滚动位置。 */
interface DirectoryTabView {
	readonly tabId: string;
	readonly container: HTMLElement;
	readonly content: HTMLElement;
	readonly scrollable: DomScrollableElement;
	readonly renderDisposables: DisposableStore;
	renderedLocation: string | undefined;
	renderedRefreshToken: number;
	renderedQuery: string;
	requestId: number;
	/** 目录完整数据集；排序、过滤和虚拟滚动都基于它，不再分页读取。 */
	entries: readonly SideXExplorerEntry[] | undefined;
	virtualList: VirtualFileList | undefined;
}

const FILE_ROW_HEIGHT = 28;
const FILE_LIST_OVERSCAN = 8;

/** 虚拟文件列表对编辑器暴露的回调集合。 */
interface IFileListHost extends IFileListCommandHost {
	renderRow(entry: SideXExplorerEntry): HTMLElement;
	activateEntry(entry: SideXExplorerEntry): void;
	selectionChanged(entries: readonly SideXExplorerEntry[], primary: SideXExplorerEntry | undefined): void;
	showContextMenu(event: MouseEvent, entry?: SideXExplorerEntry): void;
	dropEntries(sources: readonly string[], targetDirectory: string, mode: 'copy' | 'move' | 'auto'): void;
	onFocusChange(focused: boolean): void;
	getLocation(): string;
}

/** 读取应用内拖拽携带的路径列表。 */
function readDraggedPaths(dataTransfer: DataTransfer | null): string[] {
	if (!dataTransfer) {
		return [];
	}
	const raw = dataTransfer.getData(SIDEX_FILES_MIME);
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
			}
		} catch {
			// 忽略无法解析的拖拽数据。
		}
	}
	return [];
}

/**
 * 只渲染可视区域附近的文件行，按固定行高把滚动位置映射到数据集索引。
 * 滚动时增量回收/复用行元素，避免 10,000 项一次性创建 DOM。
 */
class VirtualFileList extends Disposable {

	private readonly list: HTMLElement;
	private readonly rows = new Map<number, HTMLElement>();
	private readonly rowIdPrefix: string;
	private entries: readonly SideXExplorerEntry[];
	private selectedPaths = new Set<string>();
	private primaryPath: string | undefined;
	private anchorIndex = -1;
	private firstRendered = -1;
	private lastRendered = -1;
	private updateHandle: number | undefined;
	private dropTarget: HTMLElement | undefined;
	private listDropTarget = false;

	constructor(
		parent: HTMLElement,
		private readonly content: HTMLElement,
		private readonly scrollable: DomScrollableElement,
		private readonly host: IFileListHost,
		tabId: string,
		entries: readonly SideXExplorerEntry[],
		selectedPaths: readonly string[],
		primaryPath: string | undefined
	) {
		super();
		this.entries = entries;
		this.rowIdPrefix = `sidex-file-row-${tabId}`;

		const list = append(parent, $('div.sidex-file-list'));
		list.tabIndex = 0;
		list.setAttribute('role', 'listbox');
		list.setAttribute('aria-multiselectable', 'true');
		list.setAttribute('aria-label', localize('sidex.fileList.ariaLabel', '文件列表'));
		this.list = list;

		this._register(this.scrollable.onScroll(() => this.scheduleUpdate()));
		this._register(addDisposableListener(list, EventType.CLICK, event => this.onClick(event)));
		this._register(addDisposableListener(list, EventType.DBLCLICK, event => this.onDoubleClick(event)));
		this._register(addDisposableListener(list, EventType.KEY_DOWN, event => this.onKeyDown(event)));
		this._register(addDisposableListener(list, EventType.CONTEXT_MENU, event => this.onContextMenu(event)));
		this._register(addDisposableListener(list, EventType.DRAG_START, event => this.onDragStart(event)));
		this._register(addDisposableListener(list, EventType.DRAG_OVER, event => this.onDragOver(event)));
		this._register(addDisposableListener(list, EventType.DRAG_LEAVE, event => this.onDragLeave(event)));
		this._register(addDisposableListener(list, EventType.DROP, event => this.onDrop(event)));
		this._register(addDisposableListener(list, EventType.FOCUS_IN, () => this.host.onFocusChange(true)));
		this._register(addDisposableListener(list, EventType.FOCUS_OUT, event => {
			const related = (event as FocusEvent).relatedTarget as Node | null;
			if (!related || !list.contains(related)) {
				this.host.onFocusChange(false);
			}
		}));
		this._register(toDisposable(() => this.cancelUpdate()));

		this.setEntries(entries, selectedPaths, primaryPath);
	}

	setEntries(
		entries: readonly SideXExplorerEntry[],
		selectedPaths: readonly string[],
		primaryPath: string | undefined
	): void {
		this.entries = entries;
		this.selectedPaths = new Set(selectedPaths);
		this.primaryPath = primaryPath && this.selectedPaths.has(primaryPath) ? primaryPath : selectedPaths[0];
		this.anchorIndex = this.primaryPath
			? entries.findIndex(entry => entry.path === this.primaryPath)
			: -1;
		for (const row of this.rows.values()) {
			row.remove();
		}
		this.rows.clear();
		this.firstRendered = -1;
		this.lastRendered = -1;
		this.list.style.height = `${entries.length * FILE_ROW_HEIGHT}px`;
		this.update();
	}

	/** 窗口尺寸或滚动条状态变化后重新计算可视区间。 */
	update(): void {
		const total = this.entries.length;
		const listTop = this.list.offsetTop;
		const viewportTop = Math.max(0, this.scrollable.getScrollPosition().scrollTop - listTop);
		const viewportHeight = this.content.clientHeight;
		const first = Math.max(
			0,
			Math.min(total, Math.floor(viewportTop / FILE_ROW_HEIGHT) - FILE_LIST_OVERSCAN)
		);
		const visibleRows = Math.ceil(viewportHeight / FILE_ROW_HEIGHT) + FILE_LIST_OVERSCAN * 2 + 2;
		const last = Math.min(total, first + visibleRows);

		if (first === this.firstRendered && last === this.lastRendered) {
			return;
		}
		this.firstRendered = first;
		this.lastRendered = last;

		for (const [index, row] of this.rows) {
			if (index < first || index >= last) {
				row.remove();
				this.rows.delete(index);
			}
		}
		for (let index = first; index < last; index++) {
			if (this.rows.has(index)) {
				continue;
			}
			const row = this.createRow(index);
			this.rows.set(index, row);
			append(this.list, row);
		}
		this.syncSelection();
	}

	focus(): void {
		this.list.focus();
	}

	getSelectedEntries(): SideXExplorerEntry[] {
		return this.entries.filter(entry => this.selectedPaths.has(entry.path));
	}

	getPrimaryEntry(): SideXExplorerEntry | undefined {
		return this.entries.find(entry => entry.path === this.primaryPath) ?? this.getSelectedEntries()[0];
	}

	selectAll(): void {
		if (!this.entries.length) {
			return;
		}
		this.anchorIndex = 0;
		this.setSelection(this.entries.map(entry => entry.path), this.getPrimaryEntry() ?? this.entries[0]);
	}

	/** 让当前选中项回到可见区域，用于键盘导航或重新排序后的定位。 */
	revealSelection(): void {
		if (!this.primaryPath) {
			return;
		}
		const index = this.entries.findIndex(entry => entry.path === this.primaryPath);
		if (index >= 0) {
			this.revealIndex(index);
		}
	}

	private scheduleUpdate(): void {
		if (this.updateHandle !== undefined) {
			return;
		}
		this.updateHandle = window.requestAnimationFrame(() => {
			this.updateHandle = undefined;
			this.update();
		});
	}

	private cancelUpdate(): void {
		if (this.updateHandle !== undefined) {
			window.cancelAnimationFrame(this.updateHandle);
			this.updateHandle = undefined;
		}
	}

	private createRow(index: number): HTMLElement {
		const entry = this.entries[index];
		const row = this.host.renderRow(entry);
		row.id = `${this.rowIdPrefix}-${index}`;
		row.dataset.index = String(index);
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', this.selectedPaths.has(entry.path) ? 'true' : 'false');
		row.classList.toggle('selected', this.selectedPaths.has(entry.path));
		row.style.top = `${index * FILE_ROW_HEIGHT}px`;
		row.tabIndex = -1;
		return row;
	}

	private syncSelection(): void {
		let activeDescendant: string | undefined;
		for (const [index, row] of this.rows) {
			const entry = this.entries[index];
			const selected = !!entry && this.selectedPaths.has(entry.path);
			row.classList.toggle('selected', selected);
			row.setAttribute('aria-selected', selected ? 'true' : 'false');
			if (entry?.path === this.primaryPath) {
				activeDescendant = row.id;
			}
		}
		if (activeDescendant) {
			this.list.setAttribute('aria-activedescendant', activeDescendant);
		} else {
			this.list.removeAttribute('aria-activedescendant');
		}
	}

	private setSelection(paths: readonly string[], primary: SideXExplorerEntry | undefined): void {
		this.selectedPaths = new Set(paths);
		const nextPrimary = primary?.path ?? paths[0];
		this.primaryPath = nextPrimary;
		if (nextPrimary) {
			const index = this.entries.findIndex(entry => entry.path === nextPrimary);
			if (index >= 0) {
				this.anchorIndex = index;
			}
		}
		this.syncSelection();
		this.host.selectionChanged(this.getSelectedEntries(), this.getPrimaryEntry());
	}

	private selectIndex(index: number, reveal: boolean, extend = false): void {
		const entry = this.entries[index];
		if (!entry) {
			return;
		}
		if (extend && this.anchorIndex >= 0) {
			const from = Math.min(this.anchorIndex, index);
			const to = Math.max(this.anchorIndex, index);
			this.setSelection(
				this.entries.slice(from, to + 1).map(item => item.path),
				entry
			);
		} else {
			this.anchorIndex = index;
			this.setSelection([entry.path], entry);
		}
		if (reveal) {
			this.revealIndex(index);
		}
	}

	private revealIndex(index: number): void {
		const listTop = this.list.offsetTop;
		const viewportHeight = this.content.clientHeight;
		const visibleTop = Math.max(0, this.scrollable.getScrollPosition().scrollTop - listTop);
		const rowTop = index * FILE_ROW_HEIGHT;
		if (rowTop < visibleTop) {
			this.scrollable.setScrollPosition({ scrollTop: listTop + rowTop });
		} else if (rowTop + FILE_ROW_HEIGHT > visibleTop + viewportHeight) {
			this.scrollable.setScrollPosition({
				scrollTop: Math.max(0, listTop + rowTop + FILE_ROW_HEIGHT - viewportHeight)
			});
		}
		this.update();
	}

	private rowFromEvent(event: Event): HTMLElement | undefined {
		const target = event.target as HTMLElement | null;
		const row = target?.closest('.sidex-file-row');
		return row instanceof HTMLElement && this.list.contains(row) ? row : undefined;
	}

	private entryFromRow(row: HTMLElement | undefined): SideXExplorerEntry | undefined {
		if (!row) {
			return undefined;
		}
		const index = Number(row.dataset.index);
		return Number.isInteger(index) ? this.entries[index] : undefined;
	}

	private onClick(event: MouseEvent): void {
		const row = this.rowFromEvent(event);
		if (!row) {
			this.list.focus();
			return;
		}
		const index = Number(row.dataset.index);
		const entry = this.entries[index];
		if (!entry) {
			return;
		}
		this.list.focus();

		if (event.shiftKey && this.anchorIndex >= 0) {
			const from = Math.min(this.anchorIndex, index);
			const to = Math.max(this.anchorIndex, index);
			this.setSelection(this.entries.slice(from, to + 1).map(item => item.path), entry);
			return;
		}
		if (event.ctrlKey || event.metaKey) {
			const next = new Set(this.selectedPaths);
			if (next.has(entry.path)) {
				next.delete(entry.path);
			} else {
				next.add(entry.path);
			}
			this.anchorIndex = index;
			this.setSelection([...next], next.has(entry.path) ? entry : undefined);
			return;
		}
		this.anchorIndex = index;
		this.setSelection([entry.path], entry);
	}

	private onDoubleClick(event: MouseEvent): void {
		const entry = this.entryFromRow(this.rowFromEvent(event));
		if (entry) {
			this.host.activateEntry(entry);
		}
	}

	private onContextMenu(event: MouseEvent): void {
		event.preventDefault();
		const entry = this.entryFromRow(this.rowFromEvent(event));
		if (entry && !this.selectedPaths.has(entry.path)) {
			this.anchorIndex = Number(this.rowFromEvent(event)?.dataset.index ?? -1);
			this.setSelection([entry.path], entry);
		}
		this.host.showContextMenu(event, entry);
	}

	private onKeyDown(event: KeyboardEvent): void {
		const total = this.entries.length;
		if (!total) {
			return;
		}
		let index = this.primaryPath
			? this.entries.findIndex(entry => entry.path === this.primaryPath)
			: -1;
		const page = Math.max(1, Math.floor(this.content.clientHeight / FILE_ROW_HEIGHT) - 1);

		switch (event.key) {
			case 'ArrowDown':
				index = index < 0 ? 0 : Math.min(total - 1, index + 1);
				break;
			case 'ArrowUp':
				index = index < 0 ? total - 1 : Math.max(0, index - 1);
				break;
			case 'PageDown':
				index = Math.min(total - 1, (index < 0 ? 0 : index) + page);
				break;
			case 'PageUp':
				index = Math.max(0, (index < 0 ? total : index) - page);
				break;
			case 'Home':
				index = 0;
				break;
			case 'End':
				index = total - 1;
				break;
			case 'Escape':
				this.setSelection([], undefined);
				event.preventDefault();
				return;
			default:
				return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.selectIndex(index, true, event.shiftKey);
	}

	private onDragStart(event: DragEvent): void {
		const row = this.rowFromEvent(event);
		const entry = this.entryFromRow(row);
		if (!row || !entry || !event.dataTransfer) {
			return;
		}
		if (!this.selectedPaths.has(entry.path)) {
			this.anchorIndex = Number(row.dataset.index ?? -1);
			this.setSelection([entry.path], entry);
		}
		const paths = this.getSelectedEntries().map(item => item.path);
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData(SIDEX_FILES_MIME, JSON.stringify(paths));
		event.dataTransfer.setData('text/plain', paths.join('\n'));
		event.dataTransfer.setDragImage(row, 12, 12);

		// 拖到 Windows 资源管理器等外部应用时作为文件下载（复制语义）。
		// 该格式只能携带单个文件，目录与多选时仅提供应用内拖放。
		const first = paths.length === 1 ? this.entries.find(item => item.path === paths[0]) : undefined;
		if (first && !first.isDir) {
			event.dataTransfer.setData(
				'DownloadURL',
				`application/octet-stream:${fileName(first.path)}:${assetUrl(first.path)}`
			);
		}
	}

	private onDragOver(event: DragEvent): void {
		if (!event.dataTransfer) {
			return;
		}
		const row = this.rowFromEvent(event);
		if (row) {
			const entry = this.entryFromRow(row);
			if (!entry?.isDir) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
			if (this.dropTarget !== row) {
				this.clearDropTarget();
				row.classList.add('drop-target');
				this.dropTarget = row;
			}
			return;
		}
		// 列表空白区域：拖到当前目录。
		event.preventDefault();
		event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
		if (!this.listDropTarget) {
			this.clearDropTarget();
			this.list.classList.add('drop-target-list');
			this.listDropTarget = true;
		}
	}

	private onDragLeave(event: DragEvent): void {
		const related = event.relatedTarget as Node | null;
		if (related && this.list.contains(related)) {
			return;
		}
		this.clearDropTarget();
	}

	private onDrop(event: DragEvent): void {
		const row = this.rowFromEvent(event);
		const entry = this.entryFromRow(row);
		if (row && !entry?.isDir) {
			return;
		}
		const sources = readDraggedPaths(event.dataTransfer);
		if (!sources.length) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.clearDropTarget();
		const target = entry?.isDir ? entry.path : this.host.getLocation();
		const mode = event.ctrlKey ? 'copy' : event.shiftKey ? 'move' : 'auto';
		this.host.dropEntries(sources, target, mode);
	}

	private clearDropTarget(): void {
		this.dropTarget?.classList.remove('drop-target');
		this.dropTarget = undefined;
		if (this.listDropTarget) {
			this.list.classList.remove('drop-target-list');
			this.listDropTarget = false;
		}
	}
}

/** sidex-asset 协议的绝对地址，供拖出到外部应用时使用。 */
function assetUrl(path: string): string {
	const normalized = path.replace(/\\/g, '/').split('/').map(segment => encodeURIComponent(segment)).join('/');
	return `https://sidex-asset.localhost/${normalized}`;
}

export class DirectoryViewEditor extends EditorPane {

	static readonly ID = 'workbench.editor.sidexDirectoryView';

	private viewsRoot: HTMLElement | undefined;
	private readonly views = new Map<string, DirectoryTabView>();
	private readonly savedScrollTops = new Map<string, number>();
	private activeTabId: string | undefined;
	private readonly viewDisposables = this._register(new DisposableStore());
	private contextMenu: HTMLElement | undefined;
	private sortKey: 'name' | 'modified' | 'type' | 'size' = 'name';
	private sortAscending = true;
	private readonly columnWidths = [260, 170, 130, 110];
	private readonly fileListFocus: ReturnType<typeof FILE_LIST_FOCUS_CONTEXT.bindTo>;

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
		@INotificationService private readonly notificationService: INotificationService,
		@IThumbnailService private readonly thumbnailService: IThumbnailService,
		@IFileOperationService private readonly fileOperationService: IFileOperationService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(DirectoryViewEditor.ID, group, telemetryService, themeService, storageService);

		this.fileListFocus = FILE_LIST_FOCUS_CONTEXT.bindTo(contextKeyService);
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
		// 尺寸变化会改变可视行数，需要重新计算虚拟窗口。
		this.activeView?.scrollable.scanDomNode();
		this.activeView?.virtualList?.update();
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
			return;
		}
		// 编辑器重新可见后，视口高度才有效，需要重新计算虚拟窗口。
		const view = this.activeView;
		if (view) {
			view.scrollable.scanDomNode();
			view.virtualList?.update();
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
			// 立即落盘，避免防抖持久化未触发时恢复到旧位置。
			this.storageService.store(
				`sidex.directory.scroll:${view.tabId}`,
				String(scrollTop),
				StorageScope.PROFILE,
				StorageTarget.MACHINE
			);
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
			renderedQuery: '',
			requestId: 0,
			entries: undefined,
			virtualList: undefined
		};
		this.views.set(tabId, view);
		return view;
	}

	/** 切换当前显示的目录视图；同一编辑器标签内完成，不新建编辑器标签。 */
	private async activateView(tabId: string | undefined, restoreScroll: boolean): Promise<void> {
		const hadListFocus = !!this.activeView?.container.contains(document.activeElement);
		if (this.activeTabId !== tabId) {
			// 视图被隐藏时浏览器不会可靠地派发 blur，主动清掉命令路由。
			this.fileListFocus.reset();
			setActiveFileListHost(undefined);
		}
		this.activeTabId = tabId;
		for (const [otherTabId, view] of this.views) {
			view.container.style.display = otherTabId === tabId ? '' : 'none';
		}
		if (!tabId) {
			return;
		}

		const view = this.ensureView(tabId);
		try {
			view.scrollable.scanDomNode();
			view.virtualList?.update();

			const persisted = Number(this.storageService.get(`sidex.directory.scroll:${tabId}`, StorageScope.PROFILE) ?? '0');
			const restoreTop = this.savedScrollTops.get(tabId) ?? persisted;
			const query = this.directoryService.searchQuery;

			const tab = this.directoryService.getTab(tabId);
			if (tab && tab.location === view.renderedLocation && tab.refreshToken === view.renderedRefreshToken) {
				// 内容已是最新：搜索词变化时只重绘，不重新读取目录。
				if (query !== view.renderedQuery && view.entries) {
					this.savedScrollTops.delete(tabId);
					this.rerenderDirectory(view, restoreScroll ? restoreTop : 0);
					return;
				}
				// 复用已有 DOM，并恢复被其他编辑器遮挡时记录的滚动位置。
				if (restoreScroll && restoreTop) {
					view.scrollable.setScrollPosition({ scrollTop: restoreTop });
					view.virtualList?.update();
				}
				this.savedScrollTops.delete(tabId);
				return;
			}

			this.savedScrollTops.delete(tabId);
			await this.reload(view, restoreScroll ? restoreTop : 0);
		} finally {
			if (hadListFocus) {
				view.virtualList?.focus();
			}
		}
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

		// 目录内容未变时，搜索词变化只需基于缓存重绘，不重新读取磁盘。
		if (tab.location === view.renderedLocation && tab.refreshToken === view.renderedRefreshToken) {
			if (this.directoryService.searchQuery !== view.renderedQuery && view.entries) {
				this.rerenderDirectory(view, 0);
				view.virtualList?.revealSelection();
			}
			return;
		}

		// 同一位置刷新时保留滚动位置；切换目录则回到顶部。
		const scrollTop = tab.location === view.renderedLocation
			? view.scrollable.getScrollPosition().scrollTop
			: 0;
		void this.reload(view, scrollTop);
	}

	private onDrivesChange(): void {
		for (const view of this.views.values()) {
			view.renderedRefreshToken = -1;
		}
		const view = this.activeView;
		if (view) {
			void this.reload(view, 0);
		}
	}

	private onFileIconThemeChange(): void {
		for (const view of this.views.values()) {
			view.renderedRefreshToken = -1;
		}
		const view = this.activeView;
		if (!view) {
			return;
		}
		if (view.entries) {
			// 图标主题只影响行内容，用缓存数据重绘即可。
			this.rerenderDirectory(view, view.scrollable.getScrollPosition().scrollTop);
			const tab = this.directoryService.getTab(view.tabId);
			if (tab) {
				view.renderedRefreshToken = tab.refreshToken;
			}
		} else {
			void this.reload(view, view.scrollable.getScrollPosition().scrollTop);
		}
	}

	private async reload(view: DirectoryTabView, scrollTop?: number): Promise<void> {
		const currentRequest = ++view.requestId;
		const tab = this.directoryService.getTab(view.tabId);
		const location = tab?.location ?? '';
		view.renderedLocation = tab ? tab.location : undefined;
		view.renderedRefreshToken = tab ? tab.refreshToken : -1;
		view.entries = undefined;
		view.virtualList = undefined;

		view.renderDisposables.clear();
		reset(view.content);
		if (!location) {
			this.renderThisPc(view);
			view.scrollable.scanDomNode();
			if (scrollTop !== undefined) {
				view.scrollable.setScrollPosition({ scrollTop });
			}
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
			view.entries = entries;
			this.renderDirectory(view, location, entries);
			view.scrollable.scanDomNode();
			if (scrollTop !== undefined) {
				view.scrollable.setScrollPosition({ scrollTop });
			}
			view.virtualList?.update();
		} catch (error) {
			if (currentRequest !== view.requestId) {
				return;
			}
			view.entries = undefined;
			reset(view.content);
			const message = append(view.content, $('.sidex-directory-status'));
			message.textContent = localize('sidex.directory.loadFailed', '无法打开此位置：{0}', error instanceof Error ? error.message : String(error));
			view.scrollable.scanDomNode();
		}
	}

	/** 使用已缓存的完整数据集重新排序/过滤/渲染，不访问磁盘。 */
	private rerenderDirectory(view: DirectoryTabView, scrollTop?: number): void {
		if (!view.entries || !view.renderedLocation) {
			void this.reload(view, scrollTop);
			return;
		}
		view.renderDisposables.clear();
		view.virtualList = undefined;
		reset(view.content);
		this.renderDirectory(view, view.renderedLocation, view.entries);
		view.scrollable.scanDomNode();
		if (scrollTop !== undefined) {
			view.scrollable.setScrollPosition({ scrollTop });
		}
		view.virtualList?.update();
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
				const scrollTop = view.scrollable.getScrollPosition().scrollTop;
				if (view.entries) {
					this.rerenderDirectory(view, scrollTop);
					view.virtualList?.revealSelection();
				} else {
					void this.reload(view, scrollTop);
				}
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

		view.content.setAttribute('data-location', location);
		view.renderedQuery = this.directoryService.searchQuery;
		this.persistScrollPosition(view);

		if (!sorted.length) {
			const empty = append(view.content, $('.sidex-file-list-empty'));
			empty.textContent = localize('sidex.fileList.empty', '此文件夹为空');
			return;
		}

		const host: IFileListHost = {
			renderRow: entry => this.renderFileRow(entry),
			activateEntry: entry => this.openEntry(entry),
			selectionChanged: (entries, primary) => this.selectionChanged(view, entries, primary),
			showContextMenu: (event, entry) => this.showContextMenu(event, view, location, entry),
			dropEntries: (sources, targetDirectory, mode) => void this.dropEntries(view, sources, targetDirectory, mode),
			onFocusChange: focused => this.onFileListFocusChange(host, focused),
			getLocation: () => location,
			rename: async () => {
				const entries = view.virtualList?.getSelectedEntries() ?? [];
				if (entries.length === 1) {
					await this.renameEntry(entries[0]);
				}
			},
			delete: async permanent => {
				await this.deleteEntries(view, view.virtualList?.getSelectedEntries() ?? [], permanent);
			},
			copy: cut => this.copySelection(view, cut),
			paste: async () => {
				await this.pasteEntry(location);
			},
			open: () => {
				const entries = view.virtualList?.getSelectedEntries() ?? [];
				if (entries.length === 1) {
					this.openEntry(entries[0]);
				}
			},
			goUp: () => this.directoryService.goUp(),
			properties: async () => {
				await this.showProperties(view.virtualList?.getSelectedEntries() ?? []);
			},
			undo: async () => {
				await this.fileOperationService.undo();
				this.directoryService.refresh();
			},
			refresh: () => this.directoryService.refresh(),
			selectAll: () => view.virtualList?.selectAll()
		};
		const selectedPaths = this.directoryService.getSelectionPaths(view.tabId);
		const primary = this.directoryService.getSelection(view.tabId)?.path;
		const virtualList = new VirtualFileList(
			view.content,
			view.content,
			view.scrollable,
			host,
			view.tabId,
			sorted,
			selectedPaths,
			primary
		);
		view.virtualList = virtualList;
		view.renderDisposables.add(virtualList);
	}

	/** 滚动时只在停下来后持久化位置，避免滚动过程中频繁写存储。 */
	private persistScrollPosition(view: DirectoryTabView): void {
		let persistTimer: number | undefined;
		view.renderDisposables.add(toDisposable(() => {
			if (persistTimer !== undefined) {
				window.clearTimeout(persistTimer);
				persistTimer = undefined;
			}
		}));
		view.renderDisposables.add(view.scrollable.onScroll(() => {
			if (persistTimer !== undefined) {
				return;
			}
			persistTimer = window.setTimeout(() => {
				persistTimer = undefined;
				const scrollTop = String(view.scrollable.getScrollPosition().scrollTop);
				this.storageService.store(
					`sidex.directory.scroll:${view.tabId}`,
					scrollTop,
					StorageScope.PROFILE,
					StorageTarget.MACHINE
				);
			}, 250);
		}));
	}

	private renderFileRow(entry: SideXExplorerEntry): HTMLElement {
		const row = $('div.sidex-file-row');
		row.setAttribute('data-path', entry.path);
		row.dataset.isDir = entry.isDir ? 'true' : 'false';
		row.draggable = true;

		const nameCell = append(row, $('span.sidex-file-name'));
		const icon = append(nameCell, $('span.sidex-file-icon'));
		this.applyFileIcon(icon, entry);
		this.attachThumbnail(icon, entry);
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

		return row;
	}

	private openEntry(entry: SideXExplorerEntry): void {
		if (entry.isDir) {
			this.directoryService.navigate(entry.path);
		} else {
			void this.editorService.openEditor({
				resource: URI.file(entry.path),
				options: { pinned: true }
			});
		}
	}

	private selectionChanged(
		_view: DirectoryTabView,
		entries: readonly SideXExplorerEntry[],
		primary: SideXExplorerEntry | undefined
	): void {
		if (!primary) {
			return;
		}
		this.directoryService.select(
			{
				path: primary.path,
				name: primary.name,
				isDir: primary.isDir,
				size: primary.size,
				modified: primary.modified
			},
			entries.map(entry => entry.path)
		);
	}

	private onFileListFocusChange(host: IFileListHost, focused: boolean): void {
		if (focused) {
			setActiveFileListHost(host);
			this.fileListFocus.set(true);
		} else {
			setActiveFileListHost(undefined);
			this.fileListFocus.reset();
		}
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

		const selected = entry ? view.virtualList?.getSelectedEntries() ?? [] : [];
		const entries = selected.length ? selected : entry ? [entry] : [];
		const clipboard = this.fileOperationService.clipboard;

		if (entries.length) {
			const single = entries.length === 1 ? entries[0] : undefined;
			addItem(localize('sidex.menu.open', '打开'), () => {
				if (single) {
					this.openEntry(single);
				}
			}, !!single);
			addItem(localize('sidex.menu.rename', '重命名'), () => {
				if (single) {
					void this.renameEntry(single);
				}
			}, !!single);
			addItem(localize('sidex.menu.copy', '复制'), () => this.copySelection(view, false));
			addItem(localize('sidex.menu.cut', '剪切'), () => this.copySelection(view, true));
			addItem(localize('sidex.menu.paste', '粘贴'), () => void this.pasteEntry(location), !!clipboard && !!location);
			addItem(localize('sidex.menu.trash', '移到回收站'), () => void this.deleteEntries(view, entries, false));
			addItem(localize('sidex.menu.deletePermanent', '永久删除'), () => void this.deleteEntries(view, entries, true));
			addItem(localize('sidex.menu.copyPath', '复制路径'), () => {
				void navigator.clipboard.writeText(entries.map(item => item.path).join('\n'));
			});
			addItem(localize('sidex.menu.properties', '属性'), () => void this.showProperties(entries));
			if (single?.isDir) {
				addItem(
					this.directoryService.isFavorite(single.path)
						? localize('sidex.menu.removeFavorite', '取消收藏')
						: localize('sidex.menu.addFavorite', '添加到收藏'),
					() => this.directoryService.toggleFavorite(single.path)
				);
			}
			addItem(
				localize('sidex.menu.undo', '撤销文件操作'),
				() => void this.undo(),
				this.fileOperationService.canUndo()
			);
		} else {
			addItem(localize('sidex.menu.newFile', '新建文件'), () => void this.createEntry(location, false));
			addItem(localize('sidex.menu.newFolder', '新建文件夹'), () => void this.createEntry(location, true));
			addItem(localize('sidex.menu.paste', '粘贴'), () => void this.pasteEntry(location), !!clipboard && !!location);
			addItem(localize('sidex.menu.refresh', '刷新'), () => this.directoryService.refresh());
			addItem(
				location && this.directoryService.isFavorite(location)
					? localize('sidex.menu.removeFavorite', '取消收藏')
					: localize('sidex.menu.addFavorite', '添加到收藏'),
				() => this.directoryService.toggleFavorite(location),
				!!location
			);
			addItem(
				localize('sidex.menu.undo', '撤销文件操作'),
				() => void this.undo(),
				this.fileOperationService.canUndo()
			);
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
		if (!location) {
			return;
		}
		const name = await this.quickInputService.input({
			prompt: folder
				? localize('sidex.newFolder.prompt', '新建文件夹名称')
				: localize('sidex.newFile.prompt', '新建文件名称'),
			placeHolder: folder ? 'New folder' : 'untitled.txt'
		});
		if (!name) {
			return;
		}
		const target = joinPath(location, name);
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
		const parent = parentDirectory(entry.path);
		const target = joinPath(parent, name);
		if (await this.explorerService.exists(target).catch(() => false)) {
			this.notificationService.warn(localize('sidex.rename.exists', '已存在同名项目：{0}', name));
			return;
		}
		try {
			await this.fileOperationService.rename(entry.path, target);
			this.directoryService.refresh();
		} catch (error) {
			this.notificationService.error(String(error));
		}
	}

	private copySelection(view: DirectoryTabView, cut: boolean): void {
		const entries = view.virtualList?.getSelectedEntries() ?? [];
		if (!entries.length) {
			return;
		}
		this.fileOperationService.setClipboard(entries.map(entry => entry.path), cut);
		this.notificationService.info(
			cut
				? localize('sidex.cut.done', '已剪切 {0} 个项目', entries.length)
				: localize('sidex.copy.done', '已复制 {0} 个项目', entries.length)
		);
	}

	private async deleteEntries(
		view: DirectoryTabView,
		entries: readonly SideXExplorerEntry[],
		permanent: boolean
	): Promise<void> {
		if (!entries.length) {
			return;
		}
		if (permanent) {
			const { confirmed } = await this.dialogService.confirm({
				type: 'warning',
				message: entries.length === 1
					? localize('sidex.deletePermanent.confirm', '永久删除“{0}”？此操作无法撤销。', entries[0].name)
					: localize('sidex.deletePermanent.confirmMany', '永久删除选中的 {0} 个项目？此操作无法撤销。', entries.length),
				primaryButton: localize('sidex.deletePermanent.action', '永久删除')
			});
			if (!confirmed) {
				return;
			}
			const result = await this.fileOperationService.deletePermanently(entries.map(entry => entry.path));
			if (result.failed.length) {
				this.notificationService.error(result.failed.map(item => `${item.path}: ${item.error}`).join('\n'));
			}
		} else {
			const { confirmed } = await this.dialogService.confirm({
				message: entries.length === 1
					? localize('sidex.trash.confirm', '将“{0}”移到回收站？', entries[0].name)
					: localize('sidex.trash.confirmMany', '将选中的 {0} 个项目移到回收站？', entries.length),
				primaryButton: localize('sidex.trash.action', '移到回收站')
			});
			if (!confirmed) {
				return;
			}
			const result = await this.fileOperationService.trash(entries.map(entry => entry.path));
			if (result.failed.length) {
				this.notificationService.error(result.failed.map(item => `${item.path}: ${item.error}`).join('\n'));
			}
		}
		this.directoryService.refreshTab(view.tabId);
	}

	private async pasteEntry(targetDirectory: string): Promise<void> {
		if (!this.fileOperationService.clipboard) {
			return;
		}
		await this.fileOperationService.paste(targetDirectory);
		this.refreshAfterOperation(targetDirectory);
	}

	private async dropEntries(
		view: DirectoryTabView,
		sources: readonly string[],
		targetDirectory: string,
		mode: 'copy' | 'move' | 'auto'
	): Promise<void> {
		if (!targetDirectory || !sources.length) {
			return;
		}
		await this.fileOperationService.moveOrCopy(sources, targetDirectory, mode);
		this.directoryService.refreshTab(view.tabId);
		this.refreshAfterOperation(targetDirectory);
	}

	/** 刷新活动视图对应的标签，以及目标目录所属的目录标签。 */
	private refreshAfterOperation(targetDirectory: string): void {
		const normalized = targetDirectory.toLowerCase();
		const targetTab = this.directoryService.tabs.find(tab => tab.location.toLowerCase() === normalized);
		if (targetTab) {
			this.directoryService.refreshTab(targetTab.id);
		} else {
			this.directoryService.refresh();
		}
	}

	private async undo(): Promise<void> {
		await this.fileOperationService.undo();
		this.directoryService.refresh();
	}

	private async showProperties(entries: readonly SideXExplorerEntry[]): Promise<void> {
		if (!entries.length) {
			return;
		}
		if (entries.length > 1) {
			const totalSize = entries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size), 0);
			await this.dialogService.info(
				localize('sidex.properties.multipleTitle', '属性 — {0} 个项目', entries.length),
				[
					localize('sidex.properties.totalSize', '总大小：{0}', formatBytes(totalSize)),
					'',
					...entries.slice(0, 50).map(entry => entry.path),
					...(entries.length > 50 ? ['…'] : [])
				].join('\n')
			);
			return;
		}

		const entry = entries[0];
		const lines: string[] = [];
		try {
			const stat = await this.explorerService.stat(entry.path);
			lines.push(localize('sidex.properties.type', '类型：{0}', entry.isDir ? localize('sidex.fileList.folder', '文件夹') : localize('sidex.fileList.file', '文件')));
			lines.push(localize('sidex.properties.size', '大小：{0}', entry.isDir ? '—' : formatBytes(stat.size)));
			lines.push(localize('sidex.properties.modified', '修改时间：{0}', new Date(stat.modified * 1000).toLocaleString()));
			lines.push(localize('sidex.properties.created', '创建时间：{0}', new Date(stat.created * 1000).toLocaleString()));
			lines.push(localize('sidex.properties.readonly', '只读：{0}', stat.readOnly ? localize('sidex.yes', '是') : localize('sidex.no', '否')));
		} catch {
			// 文件已被删除时只展示路径。
		}
		lines.push('');
		lines.push(localize('sidex.properties.path', '位置：{0}', entry.path));
		await this.dialogService.info(
			localize('sidex.properties.title', '属性 — {0}', entry.name),
			lines.join('\n')
		);
	}

	/**
	 * 异步获取缩略图；行被虚拟滚动回收或目录已切换时直接丢弃结果。
	 * 失败时保持主题图标，不改变现有回退行为。
	 */
	private attachThumbnail(icon: HTMLElement, entry: SideXExplorerEntry): void {
		if (entry.isDir) {
			return;
		}
		void this.thumbnailService.getThumbnail(entry).then(dataUrl => {
			if (!dataUrl || !icon.isConnected) {
				return;
			}
			const image = document.createElement('img');
			image.className = 'sidex-file-thumb';
			image.src = dataUrl;
			image.alt = '';
			image.draggable = false;
			icon.classList.add('has-thumbnail');
			icon.appendChild(image);
		});
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
