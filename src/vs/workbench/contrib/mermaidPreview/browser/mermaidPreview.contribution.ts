/*---------------------------------------------------------------------------------------------
 *  SideX: preview for standalone Mermaid files (.mmd / .mermaid).
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { WebviewInitInfo } from '../../webview/browser/webview.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { renderMermaid } from '../../markdown/browser/mermaidRenderer.js';

const MERMAID_PREVIEW_VIEW_TYPE = 'sidex.mermaid.preview';
const MERMAID_FILE = /\.(mmd|mermaid)$/i;

let _manager: MermaidPreviewManager | undefined;

function getOrCreateManager(accessor: ServicesAccessor): MermaidPreviewManager {
	if (!_manager) {
		_manager = accessor.get(IInstantiationService).createInstance(MermaidPreviewManager);
	}
	return _manager;
}

export class MermaidPreviewManager extends Disposable {
	private _webviewInput: WebviewInput | undefined;
	private _resource: URI | undefined;
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _listeners = this._register(new DisposableStore());
	private _renderGeneration = 0;

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IThemeService private readonly _themeService: IThemeService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
	}

	showPreview(side?: boolean): void {
		const editor = this._editorService.activeEditor;
		const resource = editor instanceof EditorInput ? editor.resource : undefined;
		if (!resource || !MERMAID_FILE.test(resource.path)) {
			this._logService.warn('[Mermaid Preview] The active editor is not a .mmd file');
			return;
		}

		this._resource = resource;
		this._createOrUpdateWebview(resource, side);
	}

	toggle(): void {
		if (this._webviewInput && !this._webviewInput.isDisposed()) {
			this._webviewInput.dispose();
			this._webviewInput = undefined;
			this._resource = undefined;
			this._listeners.clear();
		} else {
			this.showPreview();
		}
	}

	private _createOrUpdateWebview(resource: URI, side?: boolean): void {
		const title = `Preview: ${resource.path.split('/').pop() || resource.path}`;

		if (!this._webviewInput || this._webviewInput.isDisposed()) {
			const initInfo: WebviewInitInfo = {
				title,
				options: {
					retainContextWhenHidden: true
				},
				contentOptions: {
					allowScripts: true,
					localResourceRoots: []
				},
				extension: undefined
			};

			this._webviewInput = this._webviewWorkbenchService.openWebview(
				initInfo,
				MERMAID_PREVIEW_VIEW_TYPE,
				title,
				undefined,
				{ preserveFocus: true, group: side ? SIDE_GROUP : undefined }
			);

			this._register(this._webviewInput.onWillDispose(() => {
				this._clearDebounce();
				this._listeners.clear();
				this._webviewInput = undefined;
				this._resource = undefined;
			}));
		} else {
			this._webviewInput.setWebviewTitle(title);
		}

		this._render();
		this._listenToContentChanges();
	}

	private _listenToContentChanges(): void {
		this._listeners.clear();
		if (!this._resource) {
			return;
		}

		const fileModel = this._textFileService.files.get(this._resource);
		if (!fileModel) {
			return;
		}

		if (!fileModel.isResolved()) {
			this._listeners.add(this._textFileService.files.onDidResolve(event => {
				if (this._resource && event.model.resource.toString() === this._resource.toString()) {
					this._listenToContentChanges();
					this._render();
				}
			}));
			return;
		}

		this._listeners.add(fileModel.textEditorModel.onDidChangeContent(() => {
			this._clearDebounce();
			this._debounceTimer = setTimeout(() => this._render(), 300);
		}));
	}

	private _render(): void {
		if (!this._webviewInput || !this._resource) {
			return;
		}

		const fileModel = this._textFileService.files.get(this._resource);
		if (!fileModel?.isResolved()) {
			return;
		}

		const text = fileModel.textEditorModel.getValue();
		const generation = ++this._renderGeneration;
		const isLight = this._themeService.getColorTheme().type === ColorScheme.LIGHT;

		renderMermaid(text, isLight).then(svg => {
			if (generation !== this._renderGeneration || !this._webviewInput) {
				return;
			}
			this._webviewInput.webview.setHtml(this._buildDocument(svg, isLight));
		});
	}

	private _buildDocument(body: string, isLight: boolean): string {
		const theme = this._themeService.getColorTheme();
		const background = theme.getColor('editor.background')?.toString() ?? (isLight ? '#ffffff' : '#1e1e1e');
		const foreground = theme.getColor('editor.foreground')?.toString() ?? (isLight ? '#333333' : '#d4d4d4');
		const errorColor = theme.getColor('errorForeground')?.toString() ?? '#f14c4c';

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		html, body {
			margin: 0;
			padding: 16px;
			background-color: ${background};
			color: ${foreground};
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
		}
		body { display: flex; justify-content: center; }
		svg { max-width: 100%; height: auto; }
		.mermaid-error {
			margin: 0;
			overflow: auto;
			white-space: pre-wrap;
			color: ${errorColor};
			font-family: var(--vscode-editor-font-family, Consolas, monospace);
		}
	</style>
</head>
<body>${body}</body>
</html>`;
	}

	private _clearDebounce(): void {
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = undefined;
		}
	}
}

const mermaidWhen = ContextKeyExpr.or(
	ContextKeyExpr.equals('resourceLangId', 'mermaid'),
	ContextKeyExpr.regex('resourceExtname', /\.[Mm][Mm][Dd]$/),
	ContextKeyExpr.equals('editorLangId', 'mermaid')
);

CommandsRegistry.registerCommand('sidex.mermaid.openPreview', accessor => {
	getOrCreateManager(accessor).showPreview();
});

CommandsRegistry.registerCommand('sidex.mermaid.openPreviewToSide', accessor => {
	getOrCreateManager(accessor).showPreview(true);
});

CommandsRegistry.registerCommand('sidex.mermaid.togglePreview', accessor => {
	getOrCreateManager(accessor).toggle();
});

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'sidex.mermaid.openPreviewToSide',
		title: localize('mermaid.preview.title', 'Open Mermaid Preview to the Side'),
		icon: { id: Codicon.openPreview.id }
	},
	when: mermaidWhen,
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.mermaid.openPreview',
		title: localize('mermaid.openPreview', 'Mermaid: 打开预览')
	},
	when: mermaidWhen
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.mermaid.openPreviewToSide',
		title: localize('mermaid.openPreviewToSide', 'Mermaid: 在侧边打开预览')
	},
	when: mermaidWhen
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.mermaid.togglePreview',
		title: localize('mermaid.togglePreview', 'Mermaid: 切换预览')
	},
	when: mermaidWhen
});

KeybindingsRegistry.registerKeybindingRule({
	id: 'sidex.mermaid.togglePreview',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
	when: ContextKeyExpr.equals('editorLangId', 'mermaid')
});
