/*---------------------------------------------------------------------------------------------
 *  SideX: 内置 CSV 表格编辑器（替代原 WASM csv-editor 扩展）
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { CsvPreviewEditor } from './csvPreviewEditor.js';
import { CsvPreviewEditorInput } from './csvPreviewEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CsvPreviewEditor, CsvPreviewEditor.ID, localize('csvPreview', 'CSV 表格')),
	[new SyncDescriptor(CsvPreviewEditorInput)]
);

class CsvPreviewContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.csvPreview';

	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		editorResolverService.registerEditor(
			'*.csv',
			{
				id: CsvPreviewEditor.ID,
				label: localize('csvPreview', 'CSV 表格'),
				priority: RegisteredEditorPriority.option
			},
			{},
			{
				createEditorInput: ({ resource }) => ({ editor: new CsvPreviewEditorInput(resource) })
			}
		);
	}
}

registerWorkbenchContribution2(CsvPreviewContribution.ID, CsvPreviewContribution, WorkbenchPhase.BlockStartup);

const csvWhen = ContextKeyExpr.regex('resourceExtname', /\.csv$/i);

CommandsRegistry.registerCommand('sidex.csv.openTable', (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const resource = editorService.activeEditor?.resource;
	if (!resource) {
		return undefined;
	}
	return editorService.openEditor({ resource, options: { override: CsvPreviewEditor.ID, pinned: true } });
});

CommandsRegistry.registerCommand('sidex.csv.openText', (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const resource = editorService.activeEditor?.resource;
	if (!resource) {
		return undefined;
	}
	return editorService.openEditor({ resource, options: { pinned: true } });
});

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'sidex.csv.openTable',
		title: localize('csv.openTable', '用表格打开'),
		icon: { id: Codicon.table.id }
	},
	when: csvWhen,
	group: 'navigation',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.csv.openTable',
		title: localize('csv.command.openTable', 'CSV: 用表格打开')
	},
	when: csvWhen
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'sidex.csv.openText',
		title: localize('csv.command.openText', 'CSV: 用文本打开')
	},
	when: csvWhen
});
