/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import * as nls from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';

registerEditorAction(
	class FormatDocumentMultipleAction extends EditorAction {
		constructor() {
			super({
				id: 'editor.action.formatDocument.none',
				label: nls.localize2('formatDocument.label.multiple', 'Format Document'),
				precondition: ContextKeyExpr.and(
					EditorContextKeys.writable,
					EditorContextKeys.hasDocumentFormattingProvider.toNegated()
				),
				kbOpts: {
					kbExpr: EditorContextKeys.editorTextFocus,
					primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF,
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI },
					weight: KeybindingWeight.EditorContrib
				}
			});
		}

		async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
			if (!editor.hasModel()) {
				return;
			}

			const commandService = accessor.get(ICommandService);
			const notificationService = accessor.get(INotificationService);
			const languageFeaturesService = accessor.get(ILanguageFeaturesService);

			const model = editor.getModel();
			const formatterCount = languageFeaturesService.documentFormattingEditProvider.all(model).length;

			if (formatterCount > 1) {
				return commandService.executeCommand('editor.action.formatDocument.multiple');
			} else if (formatterCount === 1) {
				return commandService.executeCommand('editor.action.formatDocument');
			} else if (model.isTooLargeForSyncing()) {
				notificationService.warn(nls.localize('too.large', 'This file cannot be formatted because it is too large'));
			} else {
				const langName = model.getLanguageId();
				// SideX 没有扩展市场，无法安装格式化扩展。
				notificationService.warn(
					nls.localize('no.provider', "There is no formatter for '{0}' files installed.", langName)
				);
			}
		}
	}
);
