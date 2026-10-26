/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../common/markdownColors.js';
import './media/markdown.css';

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import {
	IWorkbenchContribution,
	WorkbenchPhase,
	registerWorkbenchContribution2
} from '../../../common/contributions.js';
import { MarkdownPreviewManager } from './markdownPreview.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import type { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';

let _previewManager: MarkdownPreviewManager | undefined;

function getOrCreateManager(accessor: ServicesAccessor): MarkdownPreviewManager {
	if (!_previewManager) {
		_previewManager = accessor.get(IInstantiationService).createInstance(MarkdownPreviewManager);
	}
	return _previewManager;
}

class MarkdownPreviewAutoReopen extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.markdownPreviewAutoReopen';

	private _didAutoReopen = false;

	constructor(
		@IEditorService editorService: IEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IStorageService private readonly _storageService: IStorageService
	) {
		super();

		const startupTimer = setTimeout(() => {
			this._didAutoReopen = true;
		}, 3000);
		this._register({ dispose: () => clearTimeout(startupTimer) });

		this._register(
			editorService.onDidVisibleEditorsChange(() => {
				if (this._didAutoReopen) {
					return;
				}
				this._onVisibleEditorsChanged(editorService);
			})
		);
	}

	private _onVisibleEditorsChanged(editorService: IEditorService): void {
		const activeEditor = editorService.activeEditor;
		if (!(activeEditor instanceof EditorInput)) {
			return;
		}

		const resource = activeEditor.resource;
		if (!resource || !resource.path.endsWith('.md')) {
			return;
		}

		if (_previewManager && _previewManager.hasActivePreview()) {
			return;
		}

		if (!MarkdownPreviewManager.wasPreviewOpen(this._storageService, resource)) {
			return;
		}

		this._didAutoReopen = true;
		const manager = this._instantiationService.createInstance(MarkdownPreviewManager);
		_previewManager = manager;
		manager.showPreview(true);
	}
}

registerWorkbenchContribution2(MarkdownPreviewAutoReopen.ID, MarkdownPreviewAutoReopen, WorkbenchPhase.BlockStartup);

CommandsRegistry.registerCommand('markdown.showPreview', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.showPreview();
});

CommandsRegistry.registerCommand('markdown.showPreviewToSide', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.showPreview(true);
});

CommandsRegistry.registerCommand('markdown.showSource', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.showSource();
});

CommandsRegistry.registerCommand('markdown.togglePreview', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.toggle();
});

CommandsRegistry.registerCommand('markdown.preview.refresh', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.refresh();
});

CommandsRegistry.registerCommand('markdown.reopenAsPreview', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.showPreview();
});

CommandsRegistry.registerCommand('markdown.reopenAsSource', accessor => {
	const manager = getOrCreateManager(accessor);
	manager.showSource();
});

const markdownWhen = ContextKeyExpr.or(
	ContextKeyExpr.equals('resourceLangId', 'markdown'),
	ContextKeyExpr.equals('editorLangId', 'markdown')
);

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'markdown.showPreviewToSide',
		title: localize('markdown.previewSide.title', 'Open Preview to the Side'),
		icon: { id: Codicon.openPreview.id }
	},
	alt: {
		id: 'markdown.showPreview',
		title: localize('markdown.preview.title', 'Open Preview')
	},
	when: markdownWhen,
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'markdown.showPreview',
		title: localize('markdown.showPreview', 'Markdown: Open Preview')
	},
	when: markdownWhen
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'markdown.showPreviewToSide',
		title: localize('markdown.showPreviewToSide', 'Markdown: Open Preview to the Side')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'markdown.togglePreview',
		title: localize('markdown.togglePreview', 'Markdown: Toggle Preview')
	},
	when: markdownWhen
});

KeybindingsRegistry.registerKeybindingRule({
	id: 'markdown.showPreviewToSide',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyV),
	when: markdownWhen
});

KeybindingsRegistry.registerKeybindingRule({
	id: 'markdown.togglePreview',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
	when: markdownWhen
});

const markdownEditorFocusWhen = ContextKeyExpr.and(
	ContextKeyExpr.equals('editorLangId', 'markdown'),
	ContextKeyExpr.equals('editorTextFocus', true)
);

/** Wraps the selection (or inserts an empty pair) with the given markers. */
function wrapSelection(editor: ICodeEditor | null, marker: string): void {
	const model = editor?.getModel();
	const selection = editor?.getSelection();
	if (!editor || !model || !selection) {
		return;
	}

	const selected = model.getValueInRange(selection);
	if (selected.length === 0) {
		const column = selection.startColumn + marker.length;
		editor.executeEdits('markdown', [{ range: selection, text: marker + marker }], [
			new Selection(selection.startLineNumber, column, selection.startLineNumber, column)
		]);
	} else {
		editor.executeEdits('markdown', [{ range: selection, text: marker + selected + marker }]);
	}
	editor.focus();
}

CommandsRegistry.registerCommand('markdown.toggleBold', accessor => {
	wrapSelection(accessor.get(ICodeEditorService).getActiveCodeEditor(), '**');
});

CommandsRegistry.registerCommand('markdown.toggleItalic', accessor => {
	wrapSelection(accessor.get(ICodeEditorService).getActiveCodeEditor(), '*');
});

CommandsRegistry.registerCommand('markdown.toggleInlineCode', accessor => {
	wrapSelection(accessor.get(ICodeEditorService).getActiveCodeEditor(), '`');
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'markdown.toggleBold', title: localize('markdown.toggleBold', 'Markdown: 切换粗体') },
	when: markdownWhen
});
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'markdown.toggleItalic', title: localize('markdown.toggleItalic', 'Markdown: 切换斜体') },
	when: markdownWhen
});
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'markdown.toggleInlineCode', title: localize('markdown.toggleInlineCode', 'Markdown: 切换行内代码') },
	when: markdownWhen
});

KeybindingsRegistry.registerKeybindingRule({
	id: 'markdown.toggleBold',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyB,
	when: markdownEditorFocusWhen
});

KeybindingsRegistry.registerKeybindingRule({
	id: 'markdown.toggleItalic',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyI,
	when: markdownEditorFocusWhen
});
