/*---------------------------------------------------------------------------------------------
 *  SideX: HTML preview in an integrated browser tab.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import type { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import type { WebviewInitInfo } from '../../webview/browser/webview.js';
import { ASSET_ORIGIN } from '../../sidexExplorer/common/fileKind.js';

const HTML_PREVIEW_VIEW_TYPE = 'sidex.html.preview';

function isHtml(resource: URI): boolean {
	const path = resource.path.toLowerCase();
	return path.endsWith('.html') || path.endsWith('.htm');
}

class HtmlPreviewManager extends Disposable {

	private readonly _previews = new Map<string, WebviewInput>();
	private readonly _reloadListeners = new Map<string, IDisposable>();

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService,
		@ITextFileService private readonly _textFileService: ITextFileService,
	) {
		super();
	}

	openActive(side?: boolean): void {
		const resource = this._editorService.activeEditor?.resource;
		if (!resource || !isHtml(resource)) {
			return;
		}
		this.open(resource, side);
	}

	open(resource: URI, side?: boolean): void {
		const key = resource.toString();
		const existing = this._previews.get(key);
		if (existing && !existing.isDisposed()) {
			this._editorService.openEditor(existing, { preserveFocus: false });
			return;
		}

		const name = resource.path.split('/').pop() || resource.path;
		const title = localize('htmlPreview.title', "预览: {0}", name);
		const initInfo: WebviewInitInfo = {
			title,
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: true
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [URI.joinPath(resource, '..')]
			},
			extension: undefined
		};

		const input = this._webviewWorkbenchService.openWebview(
			initInfo,
			HTML_PREVIEW_VIEW_TYPE,
			title,
			undefined,
			{ preserveFocus: side, group: side ? SIDE_GROUP : undefined }
		);
		this._previews.set(key, input);

		this._register(input.onWillDispose(() => {
			this._previews.delete(key);
			this._reloadListeners.get(key)?.dispose();
			this._reloadListeners.delete(key);
		}));

		// Saving the source page reloads the preview, like a browser refresh.
		const reloadListener = this._textFileService.files.onDidSave(event => {
			if (event.model.resource.toString() === key) {
				this._render(input, resource);
			}
		});
		this._reloadListeners.set(key, reloadListener);
		this._register(reloadListener);

		this._render(input, resource);
	}

	private _render(input: WebviewInput, resource: URI): void {
		const url = `${ASSET_ORIGIN}${resource.path}?t=${Date.now()}`;
		input.webview.setHtml(this._buildDocument(url, resource));
	}

	private _buildDocument(url: string, resource: URI): string {
		const escapedUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *; script-src * 'unsafe-inline' 'unsafe-eval';">
<title>${resource.path.split('/').pop() || 'preview'}</title>
<style>
	html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
	iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
	<iframe src="${escapedUrl}"></iframe>
</body>
</html>`;
	}
}

let _previewManager: HtmlPreviewManager | undefined;

function getOrCreateManager(accessor: ServicesAccessor): HtmlPreviewManager {
	if (!_previewManager) {
		_previewManager = accessor.get(IInstantiationService).createInstance(HtmlPreviewManager);
	}
	return _previewManager;
}

CommandsRegistry.registerCommand('sidex.html.openPreview', accessor => {
	getOrCreateManager(accessor).openActive();
});

CommandsRegistry.registerCommand('sidex.html.openPreviewToSide', accessor => {
	getOrCreateManager(accessor).openActive(true);
});

const htmlWhen = ContextKeyExpr.equals('resourceLangId', 'html');

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'sidex.html.openPreviewToSide',
		title: localize('htmlPreview.openToSide', "在集成浏览器中打开"),
		icon: { id: Codicon.globe.id }
	},
	when: htmlWhen,
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.html.openPreview',
		title: localize('htmlPreview.command', "HTML: 在集成浏览器中打开"),
		icon: { id: Codicon.globe.id }
	},
	when: htmlWhen
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.html.openPreviewToSide',
		title: localize('htmlPreview.commandToSide', "HTML: 在集成浏览器中打开（侧边）"),
		icon: { id: Codicon.globe.id }
	}
});
