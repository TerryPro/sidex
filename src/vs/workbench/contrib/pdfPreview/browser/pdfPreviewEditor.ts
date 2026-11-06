/*---------------------------------------------------------------------------------------------
 *  SideX: 内置 PDF 预览编辑器（基于 pdf.js）
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, Dimension, EventType } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PdfPreviewEditorInput } from './pdfPreviewEditorInput.js';

// 只在打开 PDF 时才动态加载 pdf.js 内核与 viewer，避免进入启动主包。
import type * as PdfjsLib from 'pdfjs-dist';
import type * as PdfViewerModule from 'pdfjs-dist/web/pdf_viewer.mjs';
import './media/pdfPreview.css';

const ZOOM_FACTOR = 1.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const TOOLBAR_HEIGHT = 30;
const FINDBAR_HEIGHT = 30;
const THUMBNAIL_WIDTH = 120;
const PRINT_SCALE = 1.5;
const FIND_DEBOUNCE = 250;

/** pdf.js 的 TextLayerMode.ENABLE，避免额外依赖枚举导出。 */
const TEXT_LAYER_ENABLE = 1;

type SidebarMode = 'thumbnails' | 'outline' | undefined;

interface ThumbnailEntry {
	pageNumber: number;
	element: HTMLElement;
	canvas: HTMLCanvasElement;
	rendered: boolean;
}

export class PdfPreviewEditor extends EditorPane {

	static readonly ID = 'workbench.editor.pdfPreview';

	private container!: HTMLElement;
	private mainColumn!: HTMLElement;
	private sidebar!: HTMLElement;
	private thumbnailsContainer!: HTMLElement;
	private outlineContainer!: HTMLElement;
	private scrollContainer!: HTMLElement;
	private pagesHost!: HTMLElement;
	private pageInput!: HTMLInputElement;
	private pageCountLabel!: HTMLElement;
	private zoomLabel!: HTMLElement;
	private previousButton!: HTMLButtonElement;
	private nextButton!: HTMLButtonElement;
	private sidebarToggleButton!: HTMLButtonElement;
	private thumbnailTab!: HTMLButtonElement;
	private outlineTab!: HTMLButtonElement;
	private findBar!: HTMLElement;
	private findInput!: HTMLInputElement;
	private findCountLabel!: HTMLElement;
	private messageContainer: HTMLElement | undefined;

	private readonly viewerAbort = new AbortController();
	private pdfjs: typeof import('pdfjs-dist') | undefined;
	private pdfjsReady: Promise<void> | undefined;
	private eventBus: PdfViewerModule.EventBus | undefined;
	private linkService: PdfViewerModule.PDFLinkService | undefined;
	private findController: PdfViewerModule.PDFFindController | undefined;
	private pdfViewer: PdfViewerModule.PDFViewer | undefined;
	private pdfDocument: PdfjsLib.PDFDocumentProxy | undefined;
	private loadingTask: PdfjsLib.PDFDocumentLoadingTask | undefined;
	private currentInput: PdfPreviewEditorInput | undefined;

	private thumbnails: ThumbnailEntry[] = [];
	private thumbnailObserver: IntersectionObserver | undefined;
	private activeThumbnail: HTMLElement | undefined;
	private sidebarMode: SidebarMode = 'thumbnails';
	private sidebarVisible = false;

	private findTimeout: number | undefined;
	private findBarVisible = false;

	private panButton!: HTMLButtonElement;
	private panMode = false;
	private panning = false;
	private panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };

	private currentPage = 1;
	private fitMode = true;
	private reloading = false;
	private disposed = false;
	private printing = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super(PdfPreviewEditor.ID, group, telemetryService, themeService, storageService);

		// 文件在磁盘上变化时重新加载，保持当前页码
		this._register(this.fileService.onDidFilesChange(event => {
			if (this.currentInput && event.affects(this.currentInput.resource)) {
				void this.reload();
			}
		}));
	}

	// --- 编辑器生命周期 ---

	protected createEditor(parent: HTMLElement): void {
		this.container = $('.pdf-preview-editor');
		this.container.style.cssText = 'display:flex;flex-direction:row;width:100%;height:100%;overflow:hidden;outline:none';
		this.container.tabIndex = 0;

		this.createSidebar();
		this.createMainColumn();

		parent.appendChild(this.container);

		this.pdfjsReady = this.initializePdfjs();

		// 滚轮：Ctrl/⌘ 缩放，其余情况由我们自己滚动容器，
		// 避免个别环境下嵌套滚动容器收不到原生的滚轮滚动
		this._register(addDisposableListener(this.scrollContainer, EventType.MOUSE_WHEEL, (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				this.zoomBy(e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
				return;
			}
			const dx = this.normalizeWheelDelta(e.deltaX, e.deltaMode, true);
			const dy = this.normalizeWheelDelta(e.deltaY, e.deltaMode, false);
			if (dx === 0 && dy === 0) {
				return;
			}
			e.preventDefault();
			this.scrollContainer.scrollLeft += dx;
			this.scrollContainer.scrollTop += dy;
		}, { passive: false }));

		// 抓手拖动：按住左键拖动页面
		this._register(addDisposableListener(this.scrollContainer, 'pointerdown', (e: PointerEvent) => {
			if (!this.panMode || e.button !== 0) {
				return;
			}
			e.preventDefault();
			this.panning = true;
			this.panStart = {
				x: e.clientX,
				y: e.clientY,
				scrollLeft: this.scrollContainer.scrollLeft,
				scrollTop: this.scrollContainer.scrollTop
			};
			this.container.classList.add('panning');
			this.scrollContainer.setPointerCapture(e.pointerId);
		}));
		this._register(addDisposableListener(this.scrollContainer, 'pointermove', (e: PointerEvent) => {
			if (!this.panning) {
				return;
			}
			e.preventDefault();
			this.scrollContainer.scrollLeft = this.panStart.scrollLeft - (e.clientX - this.panStart.x);
			this.scrollContainer.scrollTop = this.panStart.scrollTop - (e.clientY - this.panStart.y);
		}));
		const endPan = (e: PointerEvent) => {
			if (!this.panning) {
				return;
			}
			this.panning = false;
			this.container.classList.remove('panning');
			if (this.scrollContainer.hasPointerCapture?.(e.pointerId)) {
				this.scrollContainer.releasePointerCapture(e.pointerId);
			}
		};
		this._register(addDisposableListener(this.scrollContainer, 'pointerup', endPan));
		this._register(addDisposableListener(this.scrollContainer, 'pointercancel', endPan));

		this._register(addDisposableListener(this.container, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
				e.preventDefault();
				e.stopPropagation();
				this.setFindBarVisible(true);
			} else if (e.key === 'Escape' && this.findBarVisible) {
				e.preventDefault();
				this.setFindBarVisible(false);
			}
		}));

		// 点击正文区域后把焦点交给面板，保证 Ctrl+F 等快捷键生效
		this._register(addDisposableListener(this.scrollContainer, EventType.MOUSE_DOWN, () => this.focus()));
	}

	private createSidebar(): void {
		this.sidebar = $('.pdf-preview-sidebar');

		// 顶部视图切换条（对应官方 viewer 的 sidebar toolbar）
		const header = $('.pdf-preview-sidebar-header');
		this.thumbnailTab = this.createIconButton(header, Codicon.files, localize('pdfPreview.thumbnails', '缩略图'), () => this.selectSidebarMode('thumbnails'));
		this.outlineTab = this.createIconButton(header, Codicon.listTree, localize('pdfPreview.outline', '文档大纲'), () => this.selectSidebarMode('outline'));
		this.sidebar.appendChild(header);

		this.thumbnailsContainer = $('.pdf-preview-thumbnails');
		this.outlineContainer = $('.pdf-preview-outline');
		this.sidebar.appendChild(this.thumbnailsContainer);
		this.sidebar.appendChild(this.outlineContainer);

		const resizer = $('.pdf-preview-sidebar-resizer');
		this.sidebar.appendChild(resizer);
		this._register(addDisposableListener(resizer, 'pointerdown', (e: PointerEvent) => this.startSidebarResize(resizer, e)));

		this.container.appendChild(this.sidebar);
	}

	private startSidebarResize(resizer: HTMLElement, e: PointerEvent): void {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = this.sidebar.getBoundingClientRect().width;
		resizer.classList.add('dragging');
		resizer.setPointerCapture(e.pointerId);

		const onMove = (event: PointerEvent) => {
			const width = Math.min(480, Math.max(140, startWidth + (event.clientX - startX)));
			this.sidebar.style.width = `${Math.round(width)}px`;
			this.relayout();
		};
		const onEnd = (event: PointerEvent) => {
			resizer.classList.remove('dragging');
			resizer.removeEventListener('pointermove', onMove);
			resizer.removeEventListener('pointerup', onEnd);
			resizer.removeEventListener('pointercancel', onEnd);
			if (resizer.hasPointerCapture?.(event.pointerId)) {
				resizer.releasePointerCapture(event.pointerId);
			}
			this.relayout();
		};

		resizer.addEventListener('pointermove', onMove);
		resizer.addEventListener('pointerup', onEnd);
		resizer.addEventListener('pointercancel', onEnd);
	}

	private createMainColumn(): void {
		this.mainColumn = $('.pdf-preview-main');
		this.mainColumn.style.cssText = 'display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0';

		this.createToolbar();
		this.createFindBar();

		const viewerWrapper = $('.pdf-preview-viewer');
		viewerWrapper.style.cssText = 'position:relative;flex:1 1 auto;min-height:0;background:var(--vscode-editor-background)';

		// pdf.js 要求传入的 container 是绝对定位的 DIV，且其中的 viewer 是其子节点
		this.scrollContainer = $('.pdf-preview-scroll');
		this.scrollContainer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;overflow:auto';

		this.pagesHost = $('.pdfViewer');
		this.scrollContainer.appendChild(this.pagesHost);
		viewerWrapper.appendChild(this.scrollContainer);

		this.mainColumn.appendChild(viewerWrapper);
		this.container.appendChild(this.mainColumn);
	}

	private createToolbar(): void {
		const toolbar = $('.pdf-preview-toolbar');
		toolbar.style.cssText = [
			'display:flex;align-items:center;gap:4px;padding:0 8px;overflow:hidden;white-space:nowrap',
			`height:${TOOLBAR_HEIGHT}px;flex:0 0 auto;box-sizing:border-box`,
			'font-size:12px;user-select:none',
			'border-bottom:1px solid var(--vscode-editorGroup-border, transparent)'
		].join(';');

		this.sidebarToggleButton = this.createIconButton(toolbar, Codicon.layoutSidebarLeft, localize('pdfPreview.toggleSidebar', '侧边栏'), () => this.toggleSidebar());
		this.createVerticalSeparator(toolbar);

		this.previousButton = this.createIconButton(toolbar, Codicon.chevronLeft, localize('pdfPreview.previousPage', '上一页'), () => this.goToPage(this.currentPage - 1));
		this.nextButton = this.createIconButton(toolbar, Codicon.chevronRight, localize('pdfPreview.nextPage', '下一页'), () => this.goToPage(this.currentPage + 1));

		this.pageInput = document.createElement('input');
		this.pageInput.type = 'text';
		this.pageInput.spellcheck = false;
		this.pageInput.title = localize('pdfPreview.pageNumber', '页码');
		this.pageInput.style.cssText = [
			'width:44px;height:20px;padding:0 2px;text-align:center;font-size:12px',
			'background:var(--vscode-input-background);color:var(--vscode-input-foreground)',
			'border:1px solid var(--vscode-input-border, transparent);border-radius:2px;outline:none'
		].join(';');
		this._register(addDisposableListener(this.pageInput, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				this.goToPage(Number(this.pageInput.value));
				this.container.focus();
			} else if (e.key === 'Escape') {
				this.syncPageInput();
				this.container.focus();
			}
		}));
		this._register(addDisposableListener(this.pageInput, EventType.BLUR, () => this.syncPageInput()));
		toolbar.appendChild(this.pageInput);

		this.pageCountLabel = $('span');
		this.pageCountLabel.style.cssText = 'opacity:0.8;white-space:nowrap';
		this.pageCountLabel.textContent = '/ 0';
		toolbar.appendChild(this.pageCountLabel);

		this.createVerticalSeparator(toolbar);

		this.createIconButton(toolbar, Codicon.zoomOut, localize('pdfPreview.zoomOut', '缩小'), () => this.zoomBy(1 / ZOOM_FACTOR));
		this.zoomLabel = $('span');
		this.zoomLabel.style.cssText = 'min-width:38px;text-align:center;opacity:0.8';
		this.zoomLabel.textContent = '100%';
		toolbar.appendChild(this.zoomLabel);
		this.createIconButton(toolbar, Codicon.zoomIn, localize('pdfPreview.zoomIn', '放大'), () => this.zoomBy(ZOOM_FACTOR));
		this.createIconButton(toolbar, Codicon.arrowBoth, localize('pdfPreview.fitWidth', '适合宽度'), () => this.fitWidth());
		this.panButton = this.createIconButton(toolbar, Codicon.move, localize('pdfPreview.panMode', '拖动浏览（抓手）'), () => this.setPanMode(!this.panMode));

		const spacer = $('span');
		spacer.style.cssText = 'flex:1 1 auto';
		toolbar.appendChild(spacer);

		this.createIconButton(toolbar, Codicon.search, localize('pdfPreview.find', '查找'), () => this.setFindBarVisible(true));
		this.createTextButton(toolbar, localize('pdfPreview.print', '打印'), () => void this.printDocument());

		this.mainColumn.appendChild(toolbar);
	}

	private createFindBar(): void {
		this.findBar = $('.pdf-preview-findbar');
		this.findBar.style.cssText = [
			'display:none;align-items:center;gap:4px;padding:0 8px',
			`height:${FINDBAR_HEIGHT}px;flex:0 0 auto;box-sizing:border-box`,
			'border-bottom:1px solid var(--vscode-editorGroup-border, transparent)'
		].join(';');

		this.findInput = document.createElement('input');
		this.findInput.type = 'text';
		this.findInput.placeholder = localize('pdfPreview.findPlaceholder', '在文档中查找');
		this.findInput.spellcheck = false;
		this.findInput.style.cssText = [
			'flex:0 1 220px;height:20px;padding:0 4px;font-size:12px',
			'background:var(--vscode-input-background);color:var(--vscode-input-foreground)',
			'border:1px solid var(--vscode-input-border, transparent);border-radius:2px;outline:none'
		].join(';');
		this._register(addDisposableListener(this.findInput, EventType.INPUT, () => this.scheduleFind()));
		this._register(addDisposableListener(this.findInput, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.runFind('again', e.shiftKey);
			}
		}));
		this.findBar.appendChild(this.findInput);

		this.findCountLabel = $('span');
		this.findCountLabel.style.cssText = 'min-width:52px;font-size:12px;opacity:0.8;text-align:center';
		this.findBar.appendChild(this.findCountLabel);

		this.createIconButton(this.findBar, Codicon.chevronLeft, localize('pdfPreview.findPrevious', '上一个匹配'), () => this.runFind('again', true));
		this.createIconButton(this.findBar, Codicon.chevronRight, localize('pdfPreview.findNext', '下一个匹配'), () => this.runFind('again', false));
		this.createIconButton(this.findBar, Codicon.close, localize('pdfPreview.closeFind', '关闭查找'), () => this.setFindBarVisible(false));

		this.mainColumn.appendChild(this.findBar);
	}

	private createIconButton(parent: HTMLElement, icon: ThemeIcon, title: string, onClick: () => void): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'pdf-preview-button';
		button.title = title;

		const iconElement = $('span');
		iconElement.className = ThemeIcon.asClassName(icon);
		button.appendChild(iconElement);

		this._register(addDisposableListener(button, EventType.CLICK, onClick));
		parent.appendChild(button);
		return button;
	}

	private createTextButton(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'pdf-preview-text-button';
		button.textContent = label;
		this._register(addDisposableListener(button, EventType.CLICK, onClick));
		parent.appendChild(button);
		return button;
	}

	private createVerticalSeparator(parent: HTMLElement): void {
		const separator = $('span');
		separator.className = 'pdf-preview-separator';
		parent.appendChild(separator);
	}

	// --- pdf.js 集成 ---

	private async initializePdfjs(): Promise<void> {
		try {
			const pdfjs = await import('pdfjs-dist');
			// worker 由 scripts/copy-pdfjs-assets.js 复制到 public/pdfjs/，用 .js 后缀
			// 保证任何静态服务都会返回 JS 的 MIME 类型
			pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.js', document.baseURI).href;
			(globalThis as unknown as { pdfjsLib: typeof pdfjs }).pdfjsLib = pdfjs;

			// pdf_viewer 在模块求值时会从 globalThis.pdfjsLib 解构内核 API，因此必须后加载
			const viewerModule = await import('pdfjs-dist/web/pdf_viewer.mjs');
			await import('pdfjs-dist/web/pdf_viewer.css');

			if (this.disposed) {
				return;
			}
			this.pdfjs = pdfjs;
			this.createViewer(viewerModule);
		} catch (error) {
			this.showMessage(
				localize(
					'pdfPreview.runtimeError',
					'加载 PDF 预览组件失败：{0}',
					error instanceof Error ? error.message : String(error)
				),
				true
			);
		}
	}

	private createViewer(viewerModule: typeof import('pdfjs-dist/web/pdf_viewer.mjs')): void {
		const { EventBus, FindState, PDFFindController, PDFLinkService, PDFViewer } = viewerModule;
		const eventBus = new EventBus();
		const linkService = new PDFLinkService({ eventBus });
		const findController = new PDFFindController({ eventBus, linkService });
		const viewer = new PDFViewer({
			container: this.scrollContainer as HTMLDivElement,
			viewer: this.pagesHost as HTMLDivElement,
			eventBus,
			linkService,
			findController,
			textLayerMode: TEXT_LAYER_ENABLE,
			removePageBorders: true,
			// 类型声明里没有 abortSignal，但运行时会用它断开内部的 ResizeObserver
			abortSignal: this.viewerAbort.signal
		} as any);
		linkService.setViewer(viewer);

		eventBus.on('pagesinit', () => {
			if (this.fitMode) {
				viewer.currentScaleValue = 'page-width';
			}
			this.pageCountLabel.textContent = `/ ${viewer.pagesCount}`;
			this.syncPageInput();
			this.updatePageButtons();
		});
		eventBus.on('pagechanging', (event: { pageNumber: number }) => {
			this.currentPage = event.pageNumber;
			this.syncPageInput();
			this.updatePageButtons();
			this.updateActiveThumbnail();
		});
		eventBus.on('scalechanging', (event: { scale: number }) => {
			this.zoomLabel.textContent = `${Math.round(event.scale * 100)}%`;
		});
		eventBus.on('updatefindmatchescount', (event: { matchesCount?: { current: number; total: number; limit?: number } }) => {
			const count = event.matchesCount;
			this.findCountLabel.textContent = count && count.total > 0 ? `${count.current}/${count.total}${count.limit ? '+' : ''}` : '';
		});
		eventBus.on('updatefindcontrolstate', (event: { state: number; matchesCount?: { current: number; total: number; limit?: number } }) => {
			if (event.state === FindState.NOT_FOUND) {
				this.findCountLabel.textContent = localize('pdfPreview.findNotFound', '无结果');
			} else if (event.state === FindState.PENDING) {
				this.findCountLabel.textContent = '…';
			} else if (event.matchesCount && event.matchesCount.total > 0) {
				this.findCountLabel.textContent = `${event.matchesCount.current}/${event.matchesCount.total}${event.matchesCount.limit ? '+' : ''}`;
			}
		});

		this.eventBus = eventBus;
		this.linkService = linkService;
		this.findController = findController;
		this.pdfViewer = viewer;
	}

	override async setInput(input: PdfPreviewEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.currentInput = input;
		await this.loadDocument(token);
	}

	private async loadDocument(token: CancellationToken): Promise<void> {
		await this.pdfjsReady;

		const resource = this.currentInput?.resource;
		const viewer = this.pdfViewer;
		if (!resource || !viewer || !this.pdfjs) {
			return;
		}

		this.releaseDocument();
		viewer.setDocument(null);
		this.linkService?.setDocument(null);
		this.showMessage(localize('pdfPreview.loading', '正在加载 PDF…'));

		let bytes: Uint8Array;
		try {
			const file = await this.fileService.readFile(resource);
			// 复制一份，pdf.js 会把 ArrayBuffer 转移（detach）给 worker
			bytes = new Uint8Array(file.value.buffer.slice(0));
		} catch (error) {
			this.showMessage(localize('pdfPreview.readError', '读取 PDF 失败：{0}', error instanceof Error ? error.message : String(error)), true);
			return;
		}

		if (token.isCancellationRequested) {
			return;
		}

		const task = this.pdfjs.getDocument({
			data: bytes,
			cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
			cMapPacked: true,
			standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
			isEvalSupported: false
		});
		this.loadingTask = task;

		try {
			const documentProxy = await task.promise;
			if (token.isCancellationRequested) {
				void task.destroy();
				return;
			}
			this.fitMode = true;
			this.currentPage = 1;
			this.pdfDocument = documentProxy;
			viewer.setDocument(documentProxy);
			this.linkService?.setDocument(documentProxy);
			this.pageInput.value = '1';
			this.hideMessage();
			this.buildThumbnails(documentProxy);
			void this.loadOutline(documentProxy);
		} catch (error) {
			this.showMessage(localize('pdfPreview.openError', '打开 PDF 失败：{0}', this.describeError(error)), true);
		}
	}

	private describeError(error: unknown): string {
		const name = error instanceof Error ? error.name : '';
		if (name === 'PasswordException') {
			return localize('pdfPreview.passwordError', '文件已加密，暂不支持输入密码');
		}
		if (name === 'InvalidPDFException') {
			return localize('pdfPreview.invalidError', '文件不是有效的 PDF');
		}
		return error instanceof Error ? error.message : String(error);
	}

	private releaseDocument(): void {
		const task = this.loadingTask;
		this.loadingTask = undefined;
		if (task) {
			void task.destroy();
		}
		this.pdfDocument = undefined;
		this.disposeThumbnails();
		this.outlineContainer.textContent = '';
		this.setFindBarVisible(false);
	}

	private async reload(): Promise<void> {
		if (this.reloading || !this.currentInput) {
			return;
		}
		this.reloading = true;
		const page = this.currentPage;
		try {
			await this.loadDocument(CancellationToken.None);
			if (page > 1) {
				this.goToPage(page);
			}
		} finally {
			this.reloading = false;
		}
	}

	// --- 侧边栏：缩略图 / 大纲 ---

	private toggleSidebar(): void {
		this.setSidebarVisible(!this.sidebarVisible);
	}

	private setSidebarVisible(visible: boolean): void {
		this.sidebarVisible = visible;
		this.sidebar.classList.toggle('visible', visible);
		this.sidebarToggleButton.classList.toggle('active', visible);
		this.updateSidebarModeClasses();

		if (visible && this.sidebarMode === 'thumbnails') {
			this.updateActiveThumbnail(true);
		}
		this.relayout();
	}

	private selectSidebarMode(mode: SidebarMode): void {
		// 再次点击当前视图 = 收起侧栏（与官方 viewer 的侧栏切换一致）
		if (this.sidebarVisible && this.sidebarMode === mode) {
			this.setSidebarVisible(false);
			return;
		}

		this.sidebarMode = mode;
		if (!this.sidebarVisible) {
			this.setSidebarVisible(true);
			return;
		}
		this.updateSidebarModeClasses();
		if (mode === 'thumbnails') {
			this.updateActiveThumbnail(true);
		}
		this.relayout();
	}

	private updateSidebarModeClasses(): void {
		const showThumbnails = this.sidebarVisible && this.sidebarMode === 'thumbnails';
		const showOutline = this.sidebarVisible && this.sidebarMode === 'outline';
		this.thumbnailTab.classList.toggle('active', showThumbnails);
		this.outlineTab.classList.toggle('active', showOutline);
		this.thumbnailsContainer.classList.toggle('visible', showThumbnails);
		this.outlineContainer.classList.toggle('visible', showOutline);
	}

	private buildThumbnails(documentProxy: PdfjsLib.PDFDocumentProxy): void {
		this.disposeThumbnails();

		this.thumbnailObserver = new IntersectionObserver(entries => {
			for (const entry of entries) {
				if (!entry.isIntersecting) {
					continue;
				}
				const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
				const thumbnail = this.thumbnails[pageNumber - 1];
				if (thumbnail) {
					void this.renderThumbnail(thumbnail);
				}
			}
		}, { root: this.thumbnailsContainer, rootMargin: '200px' });

		for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
			const element = $('.pdf-preview-thumbnail');
			element.dataset.pageNumber = String(pageNumber);

			const canvas = document.createElement('canvas');
			canvas.style.width = `${THUMBNAIL_WIDTH}px`;
			element.appendChild(canvas);

			const label = $('span.pdf-preview-thumbnail-label');
			label.textContent = String(pageNumber);
			element.appendChild(label);

			this._register(addDisposableListener(element, EventType.CLICK, () => this.goToPage(pageNumber)));

			this.thumbnailsContainer.appendChild(element);
			this.thumbnailObserver.observe(element);
			this.thumbnails.push({ pageNumber, element, canvas, rendered: false });
		}

		this.updateActiveThumbnail(true);
	}

	private async renderThumbnail(thumbnail: ThumbnailEntry): Promise<void> {
		const documentProxy = this.pdfDocument;
		if (!documentProxy || thumbnail.rendered) {
			return;
		}
		thumbnail.rendered = true;

		try {
			const page = await documentProxy.getPage(thumbnail.pageNumber);
			if (!this.pdfDocument) {
				return;
			}
			const baseViewport = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / baseViewport.width });
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const canvas = thumbnail.canvas;
			canvas.width = Math.floor(viewport.width * ratio);
			canvas.height = Math.floor(viewport.height * ratio);

			await page.render({
				canvasContext: canvas.getContext('2d'),
				viewport,
				transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
			}).promise;
		} catch {
			// 单页缩略图失败不影响主视图
		}
	}

	private updateActiveThumbnail(scrollIntoView = false): void {
		const thumbnail = this.thumbnails[this.currentPage - 1];
		if (!thumbnail || !this.sidebarVisible || this.sidebarMode !== 'thumbnails') {
			return;
		}

		if (this.activeThumbnail !== thumbnail.element) {
			this.activeThumbnail?.classList.remove('active');
			this.activeThumbnail = thumbnail.element;
			this.activeThumbnail.classList.add('active');
		}

		if (scrollIntoView) {
			thumbnail.element.scrollIntoView({ block: 'nearest' });
		}
	}

	private disposeThumbnails(): void {
		this.thumbnailObserver?.disconnect();
		this.thumbnailObserver = undefined;
		this.thumbnails = [];
		this.activeThumbnail = undefined;
		this.thumbnailsContainer.textContent = '';
	}

	private async loadOutline(documentProxy: PdfjsLib.PDFDocumentProxy): Promise<void> {
		if (!this.pdfDocument || this.pdfDocument !== documentProxy) {
			return;
		}

		let outline: any[] | null = null;
		try {
			outline = await documentProxy.getOutline();
		} catch {
			outline = null;
		}

		if (!this.pdfDocument || this.pdfDocument !== documentProxy) {
			return;
		}

		this.outlineContainer.textContent = '';
		if (!outline || outline.length === 0) {
			const empty = $('div.pdf-preview-outline-empty');
			empty.textContent = localize('pdfPreview.noOutline', '此文档没有大纲');
			this.outlineContainer.appendChild(empty);
			return;
		}

		this.outlineContainer.appendChild(this.renderOutlineItems(outline, 0));
	}

	private renderOutlineItems(items: any[], depth: number): DocumentFragment {
		const fragment = document.createDocumentFragment();

		for (const item of items) {
			const hasChildren = Array.isArray(item.items) && item.items.length > 0;

			const row = $('.pdf-preview-outline-item');

			const twisty = $('span.pdf-preview-outline-twisty');
			if (hasChildren) {
				const icon = $('span');
				icon.className = ThemeIcon.asClassName(Codicon.chevronDown);
				twisty.appendChild(icon);
			}
			row.appendChild(twisty);

			const label = $('span.pdf-preview-outline-label');
			label.textContent = item.title ?? '';
			row.appendChild(label);

			this._register(addDisposableListener(row, EventType.CLICK, () => this.jumpToOutlineItem(item)));

			fragment.appendChild(row);

			if (hasChildren) {
				const children = $('div.pdf-preview-outline-children');
				children.style.display = depth === 0 ? 'block' : 'none';
				children.appendChild(this.renderOutlineItems(item.items, depth + 1));
				fragment.appendChild(children);

				this._register(addDisposableListener(twisty, EventType.CLICK, (e: MouseEvent) => {
					e.stopPropagation();
					const expanded = children.style.display !== 'none';
					children.style.display = expanded ? 'none' : 'block';
					const icon = twisty.firstElementChild as HTMLElement | null;
					if (icon) {
						icon.className = ThemeIcon.asClassName(expanded ? Codicon.chevronRight : Codicon.chevronDown);
					}
				}));
			}
		}

		return fragment;
	}

	private jumpToOutlineItem(item: any): void {
		if (item.dest) {
			void Promise.resolve(this.linkService?.goToDestination(item.dest)).catch(() => undefined);
		} else if (item.url) {
			void this.openerService.open(URI.parse(item.url), { openExternal: true });
		}
	}

	// --- 查找 ---

	private setFindBarVisible(visible: boolean): void {
		if (!this.findBar) {
			return;
		}
		if (this.findBarVisible === visible) {
			if (visible) {
				this.findInput.focus();
				this.findInput.select();
			}
			return;
		}

		this.findBarVisible = visible;
		this.findBar.style.display = visible ? 'flex' : 'none';

		if (visible) {
			// 工具栏高度变化，重新计算可视区域
			this.relayout();
			this.findInput.focus();
			this.findInput.select();
		} else {
			this.findCountLabel.textContent = '';
			this.eventBus?.dispatch('findbarclose', { source: this });
			this.relayout();
			this.container.focus();
		}
	}

	private scheduleFind(): void {
		if (this.findTimeout !== undefined) {
			window.clearTimeout(this.findTimeout);
		}
		this.findTimeout = window.setTimeout(() => {
			this.findTimeout = undefined;
			this.runFind('', false);
		}, FIND_DEBOUNCE);
	}

	private runFind(type: string, findPrevious: boolean): void {
		const eventBus = this.eventBus;
		if (!eventBus) {
			return;
		}
		eventBus.dispatch('find', {
			source: this,
			type,
			query: this.findInput.value,
			caseSensitive: false,
			entireWord: false,
			highlightAll: true,
			findPrevious,
			matchDiacritics: false
		});
	}

	// --- 打印 ---

	private async printDocument(): Promise<void> {
		const documentProxy = this.pdfDocument;
		if (!documentProxy || this.printing) {
			return;
		}

		this.printing = true;
		const container = document.createElement('div');
		container.className = 'pdf-print-container';

		try {
			for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
				if (this.disposed || this.pdfDocument !== documentProxy) {
					return;
				}
				this.showMessage(localize('pdfPreview.printPreparing', '正在准备打印… {0} / {1}', pageNumber, documentProxy.numPages));

				const page = await documentProxy.getPage(pageNumber);
				const viewport = page.getViewport({ scale: PRINT_SCALE });
				const canvas = document.createElement('canvas');
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

				const pageElement = document.createElement('div');
				pageElement.className = 'pdf-print-page';
				const image = document.createElement('img');
				image.src = canvas.toDataURL('image/jpeg', 0.85);
				pageElement.appendChild(image);
				container.appendChild(pageElement);

				await new Promise(resolve => setTimeout(resolve, 0));
			}

			if (this.disposed) {
				return;
			}

			document.body.appendChild(container);
			window.print();
			window.addEventListener('afterprint', () => container.remove(), { once: true });
			window.setTimeout(() => container.remove(), 120000);
		} catch (error) {
			this.showMessage(localize('pdfPreview.printError', '打印失败：{0}', error instanceof Error ? error.message : String(error)), true);
			container.remove();
		} finally {
			this.printing = false;
			this.hideMessage();
		}
	}

	// --- 交互 ---

	private goToPage(page: number): void {
		const viewer = this.pdfViewer;
		if (!viewer || viewer.pagesCount === 0 || !Number.isFinite(page)) {
			this.syncPageInput();
			return;
		}
		const target = Math.min(Math.max(1, Math.round(page)), viewer.pagesCount);
		viewer.currentPageNumber = target;
		this.syncPageInput();
		this.updatePageButtons();
	}

	private zoomBy(factor: number): void {
		const viewer = this.pdfViewer;
		if (!viewer || viewer.pagesCount === 0) {
			return;
		}
		this.fitMode = false;
		viewer.currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewer.currentScale * factor));
	}

	private fitWidth(): void {
		const viewer = this.pdfViewer;
		if (!viewer || viewer.pagesCount === 0) {
			return;
		}
		this.fitMode = true;
		viewer.currentScaleValue = 'page-width';
	}

	private setPanMode(enabled: boolean): void {
		this.panMode = enabled;
		this.container.classList.toggle('pdf-pan-mode', enabled);
		this.panButton.classList.toggle('active', enabled);

		if (!enabled && this.panning) {
			this.panning = false;
			this.container.classList.remove('panning');
		}
	}

	private normalizeWheelDelta(delta: number, deltaMode: number, horizontal: boolean): number {
		if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
			return delta * 16;
		}
		if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
			const size = horizontal ? this.scrollContainer.clientWidth : this.scrollContainer.clientHeight;
			return delta * size * 0.9;
		}
		return delta;
	}

	private syncPageInput(): void {
		if (document.activeElement !== this.pageInput) {
			this.pageInput.value = String(this.currentPage);
		}
	}

	private updatePageButtons(): void {
		const pagesCount = this.pdfViewer?.pagesCount ?? 0;
		const disabled = pagesCount === 0;
		this.previousButton.disabled = disabled || this.currentPage <= 1;
		this.nextButton.disabled = disabled || this.currentPage >= pagesCount;
	}

	// --- 提示信息 ---

	private showMessage(text: string, isError = false): void {
		if (!this.messageContainer) {
			this.messageContainer = $('.pdf-preview-message');
			this.messageContainer.style.cssText = [
				'position:absolute;top:0;left:0;right:0;bottom:0',
				'display:flex;align-items:center;justify-content:center',
				'padding:24px;text-align:center;font-size:13px;opacity:0.8;z-index:10',
				'background:var(--vscode-editor-background);pointer-events:none'
			].join(';');
			this.scrollContainer.parentElement?.appendChild(this.messageContainer);
		}
		this.messageContainer.textContent = text;
		this.messageContainer.style.color = isError ? 'var(--vscode-errorForeground)' : 'inherit';
		this.messageContainer.style.display = 'flex';
	}

	private hideMessage(): void {
		if (this.messageContainer) {
			this.messageContainer.style.display = 'none';
		}
	}

	// --- 布局 / 清理 ---

	private relayout(): void {
		const viewer = this.pdfViewer;
		if (viewer && this.fitMode && viewer.pagesCount > 0) {
			requestAnimationFrame(() => {
				if (this.pdfViewer && this.fitMode && this.pdfViewer.pagesCount > 0) {
					this.pdfViewer.currentScaleValue = 'page-width';
				}
			});
		}
	}

	layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
		// 容器尺寸变化后重新适配宽度（仅当用户没有手动缩放时）
		const viewer = this.pdfViewer;
		if (viewer && this.fitMode && viewer.pagesCount > 0 && dimension.width > 0 && dimension.height > TOOLBAR_HEIGHT) {
			viewer.currentScaleValue = 'page-width';
		}
	}

	override focus(): void {
		super.focus();
		this.container?.focus();
	}

	override clearInput(): void {
		this.releaseDocument();
		this.currentInput = undefined;
		this.pdfViewer?.setDocument(null);
		this.linkService?.setDocument(null);
		this.currentPage = 1;
		this.syncPageInput();
		this.updatePageButtons();
		super.clearInput();
	}

	override dispose(): void {
		this.disposed = true;
		this.releaseDocument();
		this.viewerAbort.abort();
		this.pdfViewer = undefined;
		this.eventBus = undefined;
		this.linkService = undefined;
		this.findController = undefined;
		super.dispose();
	}
}
