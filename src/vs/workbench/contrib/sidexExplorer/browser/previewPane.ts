/*---------------------------------------------------------------------------------------------
 *  SideX — 右侧预览与属性面板
 *
 *  单击文件列表中的文件时，在辅助栏显示预览和基础属性；双击仍在主区域打开编辑器。
 *  选中项按目录标签保存在 IDirectoryService 中，切换标签时面板跟随当前标签。
 *--------------------------------------------------------------------------------------------*/

import { $, append, reset } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { FileKind, IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ISideXExplorerService } from '../../../../platform/sidex/common/sidexExplorerService.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { DirectorySelection, IDirectoryService } from './directoryService.js';

/** 超过该大小不在侧栏读取内容，避免卡住界面。 */
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 32 * 1024 * 1024;
/** 侧栏文本预览最多显示的字符数。 */
const MAX_TEXT_PREVIEW_CHARS = 20000;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg']);
const TEXT_EXTENSIONS = new Set([
	'txt', 'text', 'log', 'md', 'markdown', 'json', 'jsonc', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
	'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
	'rs', 'go', 'py', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'dart',
	'rb', 'php', 'lua', 'pl', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'sql', 'vue', 'svelte',
	'gradle', 'properties', 'env', 'csv', 'tsv', 'diff', 'patch'
]);
const TEXT_FILE_NAMES = new Set(['makefile', 'dockerfile', 'license', 'readme', 'changelog', '.gitignore', '.editorconfig']);

type PreviewKind = 'image' | 'text' | 'pdf' | 'other';

export class SideXPreviewPane extends ViewPane {

	static readonly ID = 'sidex.view.preview';

	private content: HTMLElement | undefined;
	private scrollable: DomScrollableElement | undefined;
	private textScrollable: DomScrollableElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());
	private renderToken = 0;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService,
		@IFileService private readonly fileService: IFileService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this._register(this.directoryService.onDidChangeSelection(() => this.renderPreview()));
		// 切换到另一个目录标签时，显示该标签自己的选中项。
		this._register(this.directoryService.onDidChange(() => this.renderPreview()));
		// 预览文本跟随编辑器字体设置，修改字号/字体后立即生效。
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('editor.fontSize') || event.affectsConfiguration('editor.fontFamily')) {
				this.renderPreview();
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// show-file-icons 让预览标题的文件图标与文件列表使用同一套图标主题。
		const root = append(container, $('.sidex-preview-pane.show-file-icons'));
		this.content = $('.sidex-preview-content');
		this.scrollable = this._register(new DomScrollableElement(this.content, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Visible,
			verticalScrollbarSize: 10,
			useShadows: false
		}));
		const scrollableNode = this.scrollable.getDomNode();
		scrollableNode.classList.add('sidex-preview-scrollable');
		append(root, scrollableNode);

		this.renderPreview();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.scrollable?.scanDomNode();
		this.textScrollable?.scanDomNode();
	}

	override dispose(): void {
		this.content = undefined;
		this.scrollable = undefined;
		this.textScrollable = undefined;
		super.dispose();
	}

	private renderPreview(): void {
		const content = this.content;
		if (!content) {
			return;
		}

		const token = ++this.renderToken;
		this.renderDisposables.clear();
		reset(content);

		const selection = this.directoryService.getSelection();
		if (!selection) {
			this.renderEmpty(content);
			this.scrollable?.scanDomNode();
			return;
		}

		this.renderFileHeader(content, selection);
		// 预览区占满剩余高度，属性区排在下方；内容超出时由外层滚动容器接管。
		const preview = append(content, $('.sidex-preview-section.sidex-preview-preview-section'));
		this.renderProperties(content, selection, token);

		if (selection.isDir) {
			this.renderPlaceholder(preview, Codicon.folder, localize('sidex.preview.folder', '文件夹'));
		} else {
			switch (classify(selection.name)) {
				case 'image':
					void this.renderImage(preview, selection, token);
					break;
				case 'text':
					void this.renderText(preview, selection, token);
					break;
				case 'pdf':
					this.renderPlaceholder(preview, Codicon.filePdf, localize('sidex.preview.pdf', 'PDF 文档，双击可在编辑器中打开预览。'));
					break;
				default:
					this.renderPlaceholder(preview, Codicon.fileBinary, localize('sidex.preview.unsupported', '此文件类型暂不支持预览。'));
					break;
			}
		}

		this.scrollable?.scanDomNode();
	}

	private renderEmpty(content: HTMLElement): void {
		const empty = append(content, $('.sidex-preview-empty'));
		const icon = append(empty, $('span.sidex-preview-empty-icon'));
		this.applyIcon(icon, Codicon.eye);
		icon.setAttribute('aria-hidden', 'true');
		const text = append(empty, $('.sidex-preview-empty-text'));
		text.textContent = localize('sidex.preview.empty', '选择一个文件以查看预览与属性');
	}

	private renderFileHeader(content: HTMLElement, selection: DirectorySelection): void {
		const header = append(content, $('.sidex-preview-header'));

		const icon = append(header, $('span.sidex-preview-icon'));
		this.applySelectionIcon(icon, selection);

		const title = append(header, $('.sidex-preview-title'));
		title.textContent = selection.name;
		title.title = selection.path;
	}

	private applyIcon(element: HTMLElement, icon: ThemeIcon): void {
		for (const className of ThemeIcon.asClassName(icon).split(' ')) {
			element.classList.add(className);
		}
	}

	/** 标题图标优先使用文件图标主题，与左侧文件列表保持一致。 */
	private applySelectionIcon(element: HTMLElement, selection: DirectorySelection): void {
		const fileIconTheme = this.themeService.getFileIconTheme();
		const hasThemeIcon = selection.isDir ? fileIconTheme.hasFolderIcons : fileIconTheme.hasFileIcons;
		if (hasThemeIcon) {
			for (const className of getIconClasses(
				this.modelService,
				this.languageService,
				URI.file(selection.path),
				selection.isDir ? FileKind.FOLDER : FileKind.FILE
			)) {
				element.classList.add(className);
			}
			return;
		}
		this.applyIcon(element, selection.isDir ? Codicon.folder : Codicon.file);
	}

	private renderProperties(content: HTMLElement, selection: DirectorySelection, token: number): void {
		const section = append(content, $('.sidex-preview-section.sidex-preview-properties-section'));
		const heading = append(section, $('.sidex-preview-section-title'));
		heading.textContent = localize('sidex.preview.properties', '属性');

		const grid = append(section, $('.sidex-preview-properties'));

		this.addProperty(grid, localize('sidex.preview.name', '名称'), selection.name);
		this.addProperty(grid, localize('sidex.preview.type', '类型'), typeLabel(selection));
		if (!selection.isDir) {
			this.addProperty(grid, localize('sidex.preview.size', '大小'), formatBytes(selection.size));
		}
		this.addProperty(grid, localize('sidex.preview.modified', '修改时间'), formatDateTime(selection.modified));
		const createdValue = this.addProperty(grid, localize('sidex.preview.created', '创建时间'), '—');
		this.addProperty(grid, localize('sidex.preview.path', '路径'), selection.path);
		const readOnlyValue = this.addProperty(grid, localize('sidex.preview.readonly', '只读'), '—');

		void this.loadStat(selection.path, createdValue, readOnlyValue, token);
	}

	private addProperty(grid: HTMLElement, label: string, value: string): HTMLElement {
		const labelElement = append(grid, $('span.sidex-preview-property-label'));
		labelElement.textContent = label;
		const valueElement = append(grid, $('span.sidex-preview-property-value'));
		valueElement.textContent = value;
		valueElement.title = value;
		return valueElement;
	}

	private async loadStat(path: string, createdValue: HTMLElement, readOnlyValue: HTMLElement, token: number): Promise<void> {
		try {
			const stat = await this.explorerService.stat(path);
			if (token !== this.renderToken) {
				return;
			}
			if (stat.created) {
				createdValue.textContent = formatDateTime(stat.created);
				createdValue.title = createdValue.textContent;
			}
			readOnlyValue.textContent = stat.readOnly
				? localize('sidex.preview.yes', '是')
				: localize('sidex.preview.no', '否');
			readOnlyValue.title = readOnlyValue.textContent;
		} catch {
			// 读取 stat 失败时保留占位符，不影响预览。
		}
	}

	private renderPlaceholder(section: HTMLElement, icon: ThemeIcon, message: string): void {
		const box = append(section, $('.sidex-preview-media'));
		const iconElement = append(box, $('.sidex-preview-placeholder-icon'));
		this.applyIcon(iconElement, icon);
		const text = append(box, $('.sidex-preview-placeholder-text'));
		text.textContent = message;
	}

	private async renderImage(section: HTMLElement, selection: DirectorySelection, token: number): Promise<void> {
		if (selection.size > MAX_IMAGE_PREVIEW_BYTES) {
			this.renderPlaceholder(section, Codicon.fileMedia, localize('sidex.preview.imageTooLarge', '图片过大，不在侧栏预览。'));
			return;
		}

		const box = append(section, $('.sidex-preview-media'));
		const loading = append(box, $('.sidex-preview-placeholder-text'));
		loading.textContent = localize('sidex.preview.loading', '正在加载预览…');

		try {
			const file = await this.fileService.readFile(URI.file(selection.path));
			if (token !== this.renderToken) {
				return;
			}
			const mime = imageMime(selection.name) ?? 'application/octet-stream';
			const blob = new Blob([file.value.buffer as unknown as BlobPart], { type: mime });
			const url = URL.createObjectURL(blob);
			this.renderDisposables.add(toDisposable(() => URL.revokeObjectURL(url)));

			reset(box);
			const image = append(box, $('img.sidex-preview-image')) as HTMLImageElement;
			image.src = url;
			image.alt = selection.name;
		} catch {
			if (token === this.renderToken) {
				reset(box);
				this.renderPlaceholderError(box);
			}
		}
	}

	private async renderText(section: HTMLElement, selection: DirectorySelection, token: number): Promise<void> {
		if (selection.size > MAX_TEXT_PREVIEW_BYTES) {
			this.renderPlaceholder(section, Codicon.fileText, localize('sidex.preview.textTooLarge', '文件过大，不在侧栏预览。'));
			return;
		}

		const box = append(section, $('.sidex-preview-media.sidex-preview-text-box'));
		const loading = append(box, $('.sidex-preview-placeholder-text'));
		loading.textContent = localize('sidex.preview.loading', '正在加载预览…');

		try {
			const file = await this.fileService.readFile(URI.file(selection.path));
			if (token !== this.renderToken) {
				return;
			}

			const text = file.value.toString();
			const truncated = text.length > MAX_TEXT_PREVIEW_CHARS;
			reset(box);

			const pre = $('pre.sidex-preview-text');
			pre.textContent = truncated ? text.slice(0, MAX_TEXT_PREVIEW_CHARS) : text;

			// 与编辑器保持一致，避免侧栏文本比编辑器内明显偏小。
			const fontSize = this.configurationService.getValue<number>('editor.fontSize') ?? 14;
			const fontFamily = this.configurationService.getValue<string>('editor.fontFamily') ?? 'monospace';
			pre.style.fontSize = `${fontSize}px`;
			pre.style.fontFamily = fontFamily;
			pre.style.lineHeight = `${Math.round(fontSize * 1.5)}px`;

			// 文本预览使用工作台滚动条，内容较长时可在预览区内滚动。
			// 传入受高度约束的容器，DomScrollableElement 才能正确计算可视高度。
			const textContainer = $('.sidex-preview-text-container');
			append(textContainer, pre);
			const textScrollable = new DomScrollableElement(textContainer, {
				alwaysConsumeMouseWheel: true,
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Visible,
				verticalScrollbarSize: 10,
				useShadows: false
			});
			const textScrollableNode = textScrollable.getDomNode();
			textScrollableNode.classList.add('sidex-preview-text-scrollable');
			append(box, textScrollableNode);
			this.textScrollable = textScrollable;
			this.renderDisposables.add(toDisposable(() => {
				if (this.textScrollable === textScrollable) {
					this.textScrollable = undefined;
				}
				textScrollable.dispose();
			}));

			// 等布局完成后再测量，否则滚动条会按内容高度而不是可视高度计算。
			requestAnimationFrame(() => {
				if (token === this.renderToken) {
					textScrollable.scanDomNode();
				}
			});

			if (truncated) {
				const note = append(box, $('.sidex-preview-note'));
				note.textContent = localize('sidex.preview.truncated', '仅显示前 {0} 个字符。', MAX_TEXT_PREVIEW_CHARS);
			}
		} catch {
			if (token === this.renderToken) {
				reset(box);
				this.renderPlaceholderError(box);
			}
		}
	}

	private renderPlaceholderError(box: HTMLElement): void {
		const icon = append(box, $('.sidex-preview-placeholder-icon'));
		this.applyIcon(icon, Codicon.warning);
		const text = append(box, $('.sidex-preview-placeholder-text'));
		text.textContent = localize('sidex.preview.failed', '无法预览此文件。');
	}
}

function extensionOf(name: string): string {
	const index = name.lastIndexOf('.');
	return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

function classify(name: string): PreviewKind {
	const extension = extensionOf(name);
	if (IMAGE_EXTENSIONS.has(extension)) {
		return 'image';
	}
	if (TEXT_EXTENSIONS.has(extension) || (extension === '' && TEXT_FILE_NAMES.has(name.toLowerCase()))) {
		return 'text';
	}
	if (extension === 'pdf') {
		return 'pdf';
	}
	return 'other';
}

function imageMime(name: string): string | undefined {
	switch (extensionOf(name)) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'gif':
			return 'image/gif';
		case 'bmp':
			return 'image/bmp';
		case 'webp':
			return 'image/webp';
		case 'ico':
			return 'image/x-icon';
		case 'svg':
			return 'image/svg+xml';
		default:
			return undefined;
	}
}

function typeLabel(selection: DirectorySelection): string {
	if (selection.isDir) {
		return localize('sidex.preview.folderType', '文件夹');
	}
	const extension = extensionOf(selection.name);
	return extension
		? localize('sidex.preview.fileType', '{0} 文件', extension.toUpperCase())
		: localize('sidex.preview.file', '文件');
}

function formatDateTime(seconds: number): string {
	return seconds > 0 ? new Date(seconds * 1000).toLocaleString() : '';
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
