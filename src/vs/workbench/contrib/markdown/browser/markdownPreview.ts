/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { WebviewInitInfo } from '../../webview/browser/webview.js';
import { asWebviewUri } from '../../webview/common/webview.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { DEFAULT_MARKDOWN_STYLES } from './markdownDocumentRenderer.js';
import { escapeHtml } from './mermaidRenderer.js';
import { renderMarkdownToHtml, resolveMarkdownUri } from './markdownHtml.js';
import katexStyles from 'katex/dist/katex.min.css?inline';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';

const MARKDOWN_PREVIEW_VIEW_TYPE = 'sidex.markdown.preview';
const PREVIEW_OPEN_FILES_KEY = 'markdown.preview.openFiles';

const HAS_SCHEME = /^\w[\w\d+.-]*:/;

const PREVIEW_EXTRA_STYLES = `
pre {
	padding: 12px 16px;
	overflow: auto;
	border-radius: 4px;
}

code {
	font-family: var(--vscode-editor-font-family);
}

pre code {
	font-size: var(--vscode-editor-font-size);
	line-height: 1.4;
}

.monaco-tokenized-source {
	display: block;
	white-space: pre;
}

blockquote {
	margin: 0;
	padding: 0 1em;
	border-left: 4px solid var(--vscode-textBlockQuote-border);
	color: var(--vscode-textBlockQuote-foreground);
}

img {
	max-width: 100%;
}
`;

const PREVIEW_SCRIPT = `
(function () {
	window.addEventListener('message', function (event) {
		var data = event.data;
		if (!data || data.type !== 'sidex.md.scrollToFraction') {
			return;
		}
		var value = Math.min(1, Math.max(0, Number(data.value) || 0));
		var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
		window.scrollTo(0, max * value);
	});
})();
`;

function rewriteImageSrcs(html: string, baseDir: URI): string {
	return html.replace(
		/<img\s+([^>]*?)src="([^"]*?)"([^>]*)>/gi,
		(_match, before: string, src: string, after: string) => {
			if (HAS_SCHEME.test(src) || src.startsWith('data:')) {
				return _match;
			}
			const resolved = resolveMarkdownUri(baseDir, src);
			const webviewSafe = asWebviewUri(resolved);
			return `<img ${before}src="${webviewSafe.toString()}"${after}>`;
		}
	);
}

export class MarkdownPreviewManager extends Disposable {
	private _webviewInput: WebviewInput | undefined;
	private readonly _previewDisposables = this._register(new DisposableStore());
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _currentResource: URI | undefined;
	private _scrollListener: IDisposable | undefined;
	private _renderGeneration = 0;

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IThemeService private readonly _themeService: IThemeService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService
	) {
		super();
	}

	showPreview(side?: boolean): void {
		const editor = this._editorService.activeEditor;
		if (!editor) {
			this._logService.warn('[Markdown Preview] No active editor');
			return;
		}

		const resource = editor instanceof EditorInput ? editor.resource : undefined;
		if (!resource || !resource.path.endsWith('.md')) {
			this._logService.warn('[Markdown Preview] Active editor is not a markdown file');
			return;
		}

		this._currentResource = resource;
		this._createOrUpdateWebview(resource, side);
	}

	static readonly ID = 'workbench.contrib.markdownPreview';

	toggle(): void {
		if (this._webviewInput) {
			this._closePreview();
		} else {
			this.showPreview();
		}
	}

	hasActivePreview(): boolean {
		return this._webviewInput !== undefined && !this._webviewInput.isDisposed();
	}

	refresh(): void {
		this._renderContent();
	}

	showSource(): void {
		if (!this._currentResource) {
			return;
		}
		this._editorService.openEditor({ resource: this._currentResource });
	}

	static wasPreviewOpen(storageService: IStorageService, resource: URI): boolean {
		const openFiles: string[] = JSON.parse(storageService.get(PREVIEW_OPEN_FILES_KEY, StorageScope.WORKSPACE, '[]'));
		return openFiles.includes(resource.toString());
	}

	private _createOrUpdateWebview(resource: URI, side?: boolean): void {
		const title = `Preview: ${resource.path.split('/').pop() || resource.path}`;
		const parentDir = URI.joinPath(resource, '..');

		if (!this._webviewInput) {
			const initInfo: WebviewInitInfo = {
				title,
				options: {
					enableFindWidget: true,
					retainContextWhenHidden: true
				},
				contentOptions: {
					allowScripts: true,
					localResourceRoots: [parentDir]
				},
				extension: undefined
			};

			this._webviewInput = this._webviewWorkbenchService.openWebview(
				initInfo,
				MARKDOWN_PREVIEW_VIEW_TYPE,
				title,
				undefined,
				{ preserveFocus: true, group: side ? SIDE_GROUP : undefined }
			);

			this._register(
				this._webviewInput.onWillDispose(() => {
					this._clearDebounceTimer();
					this._scrollListener?.dispose();
					this._scrollListener = undefined;
					this._webviewInput = undefined;
					this._previewDisposables.clear();
					this._currentResource = undefined;
				})
			);

			const openFiles: string[] = JSON.parse(
				this._storageService.get(PREVIEW_OPEN_FILES_KEY, StorageScope.WORKSPACE, '[]')
			);
			if (!openFiles.includes(resource.toString())) {
				openFiles.push(resource.toString());
				this._storageService.store(PREVIEW_OPEN_FILES_KEY, openFiles, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
		} else {
			this._webviewInput.setWebviewTitle(title);
		}

		this._renderContent();
		this._listenToContentChanges();
	}

	private _listenToContentChanges(): void {
		this._previewDisposables.clear();

		if (!this._currentResource) {
			return;
		}

		const fileModel = this._textFileService.files.get(this._currentResource);
		if (!fileModel) {
			return;
		}

		if (!fileModel.isResolved()) {
			this._previewDisposables.add(
				this._textFileService.files.onDidResolve(e => {
					if (this._currentResource && e.model.resource.toString() === this._currentResource.toString()) {
						this._listenToContentChanges();
						this._renderContent();
					}
				})
			);
			return;
		}

		const textModel = fileModel.textEditorModel;
		this._previewDisposables.add(
			textModel.onDidChangeContent(() => {
				if (this._debounceTimer) {
					clearTimeout(this._debounceTimer);
				}
				this._debounceTimer = setTimeout(() => {
					this._renderContent();
				}, 300);
			})
		);
	}

	private _renderContent(): void {
		if (!this._webviewInput || !this._currentResource) {
			return;
		}

		const fileModel = this._textFileService.files.get(this._currentResource);
		if (!fileModel?.isResolved()) {
			return;
		}

		const resource = this._currentResource;
		const baseDir = URI.joinPath(resource, '..');
		const text = fileModel.textEditorModel.getValue();
		const generation = ++this._renderGeneration;
		const isLight = this._themeService.getColorTheme().type === ColorScheme.LIGHT;

		this._renderMarkdown(text, isLight)
			.then(result => {
				if (generation !== this._renderGeneration || !this._webviewInput) {
					return;
				}
				const withImages = rewriteImageSrcs(result.html, baseDir);
				this._webviewInput.webview.setHtml(this._buildDocument(withImages, result.hasMath));
				this._attachScrollSync(resource);
			})
			.catch(error => {
				this._logService.warn('[Markdown Preview] render failed', error);
				if (generation !== this._renderGeneration || !this._webviewInput) {
					return;
				}
				this._webviewInput.webview.setHtml(this._buildDocument(`<pre>${escapeHtml(text)}</pre>`, false));
			});
	}

	private _renderMarkdown(text: string, isLight: boolean): Promise<{ html: string; hasMath: boolean }> {
		return renderMarkdownToHtml(text, { languageService: this._languageService, isLight });
	}

	private _buildDocument(body: string, withKatex: boolean): string {
		const theme = this._themeService.getColorTheme();
		const isLight = theme.type === ColorScheme.LIGHT;
		const background = theme.getColor('editor.background')?.toString() ?? (isLight ? '#ffffff' : '#1e1e1e');
		const foreground = theme.getColor('editor.foreground')?.toString() ?? (isLight ? '#333333' : '#d4d4d4');
		const link = theme.getColor('textLink.foreground')?.toString() ?? '#3794ff';
		const blockQuoteBorder = theme.getColor('textBlockQuote.border')?.toString() ?? 'rgba(127,127,127,0.4)';
		const blockQuoteForeground = theme.getColor('textBlockQuote.foreground')?.toString() ?? foreground;
		const codeBackground = theme.getColor('textCodeBlock.background')?.toString() ?? 'rgba(127,127,127,0.1)';
		const fontFamily = this._configurationService.getValue<string>('editor.fontFamily')
			|| 'Consolas, "Courier New", monospace';
		const fontSize = this._configurationService.getValue<number>('editor.fontSize') || 14;
		const tokenStyles = this._collectTokenStyles();
		const katexBlock = withKatex ? `<style>${katexStyles}</style>` : '';

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		:root {
			--vscode-editor-foreground: ${foreground};
			--vscode-editor-font-family: ${fontFamily};
			--vscode-editor-font-size: ${fontSize}px;
			--vscode-textCodeBlock-background: ${codeBackground};
			--vscode-textLink-foreground: ${link};
			--vscode-textBlockQuote-border: ${blockQuoteBorder};
			--vscode-textBlockQuote-foreground: ${blockQuoteForeground};
			--text-link-decoration: none;
		}
		html, body {
			background-color: ${background};
			color: ${foreground};
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
		}
		a { color: ${link}; }
		pre { background-color: ${codeBackground}; }
	</style>
	<style>${DEFAULT_MARKDOWN_STYLES}</style>
	<style>${PREVIEW_EXTRA_STYLES}</style>
	<style>${tokenStyles}</style>
	${katexBlock}
</head>
<body class="vscode-${isLight ? 'light' : 'dark'}">${body}
<script>${PREVIEW_SCRIPT}</script>
</body>
</html>`;
	}

	/**
	 * Syntax highlighting inside code blocks reuses the workbench token classes
	 * (`mtk1`, `mtk4`, ...). Those rules live in the main document's stylesheets,
	 * so copy them into the preview document to follow the current theme.
	 */
	private _collectTokenStyles(): string {
		const rules: string[] = [];
		for (const sheet of Array.from(document.styleSheets)) {
			let cssRules: CSSRuleList | undefined;
			try {
				cssRules = sheet.cssRules;
			} catch {
				continue;
			}
			if (!cssRules) {
				continue;
			}
			for (const rule of Array.from(cssRules)) {
				const selector = (rule as CSSStyleRule).selectorText;
				if (selector && /^\.mtk\d+/.test(selector)) {
					rules.push((rule as CSSStyleRule).cssText);
				}
			}
		}
		return rules.join('\n');
	}

	private _attachScrollSync(resource: URI): void {
		if (!this._webviewInput) {
			return;
		}

		this._scrollListener?.dispose();
		this._scrollListener = undefined;

		// The preview may live in another group, so the matching code editor is
		// not necessarily the active one.
		const editor = this._codeEditorService
			.listCodeEditors()
			.find(candidate => candidate.getModel()?.uri.toString() === resource.toString());
		if (!editor) {
			return;
		}

		this._scrollListener = editor.onDidScrollChange(() => {
			const layout = editor.getLayoutInfo();
			const max = Math.max(1, editor.getScrollHeight() - layout.height);
			const fraction = Math.min(1, Math.max(0, editor.getScrollTop() / max));
			this._webviewInput?.webview.postMessage({ type: 'sidex.md.scrollToFraction', value: fraction });
		});
	}

	private _clearDebounceTimer(): void {
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = undefined;
		}
	}

	private _closePreview(): void {
		if (this._webviewInput) {
			if (this._currentResource) {
				const openFiles: string[] = JSON.parse(
					this._storageService.get(PREVIEW_OPEN_FILES_KEY, StorageScope.WORKSPACE, '[]')
				);
				const filtered = openFiles.filter((f: string) => f !== this._currentResource!.toString());
				this._storageService.store(PREVIEW_OPEN_FILES_KEY, filtered, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
			this._clearDebounceTimer();
			this._scrollListener?.dispose();
			this._scrollListener = undefined;
			this._webviewInput.dispose();
			this._webviewInput = undefined;
			this._previewDisposables.clear();
			this._currentResource = undefined;
		}
	}
}
