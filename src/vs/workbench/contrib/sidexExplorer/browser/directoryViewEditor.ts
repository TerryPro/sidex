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
import { IStorageService } from '../../../../platform/storage/common/storage.js';
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

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super(DirectoryViewEditor.ID, group, telemetryService, themeService, storageService);

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
				const scrollTop = this.savedScrollTops.get(tabId);
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

	private renderDirectory(view: DirectoryTabView, location: string, entries: readonly SideXExplorerEntry[]): void {
		const sorted = [...entries].sort((a, b) => {
			if (a.isDir !== b.isDir) {
				return a.isDir ? -1 : 1;
			}
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
		});

		const header = append(view.content, $('div.sidex-file-list-header'));
		for (const column of [
			localize('sidex.fileList.name', '名称'),
			localize('sidex.fileList.modified', '修改日期'),
			localize('sidex.fileList.type', '类型'),
			localize('sidex.fileList.size', '大小')
		]) {
			const cell = append(header, $('span.sidex-file-list-column'));
			cell.textContent = column;
		}

		const list = append(view.content, $('div.sidex-file-list'));

		if (!sorted.length) {
			const empty = append(list, $('.sidex-file-list-empty'));
			empty.textContent = localize('sidex.fileList.empty', '此文件夹为空');
			return;
		}

		const rows = new Map<string, HTMLElement>();
		for (const entry of sorted) {
			rows.set(entry.path, this.renderFileRow(view, list, entry));
		}

		// 重绘后恢复该标签上次的选中项，右侧预览与列表高亮保持一致。
		const selection = this.directoryService.getSelection(view.tabId);
		if (selection) {
			rows.get(selection.path)?.classList.add('selected');
		}

		view.content.setAttribute('data-location', location);
	}

	private renderFileRow(view: DirectoryTabView, list: HTMLElement, entry: SideXExplorerEntry): HTMLElement {
		const row = append(list, $('div.sidex-file-row'));
		row.tabIndex = 0;
		row.setAttribute('data-path', entry.path);

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
				// 双击打开的文件固定为常驻标签，避免被下一次预览替换。
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

		return row;
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
