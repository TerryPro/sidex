/*---------------------------------------------------------------------------------------------
 *  SideX: 内置 PDF 预览
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { PdfPreviewEditor } from './pdfPreviewEditor.js';
import { PdfPreviewEditorInput } from './pdfPreviewEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(PdfPreviewEditor, PdfPreviewEditor.ID, localize('pdfPreview', 'PDF 预览')),
	[new SyncDescriptor(PdfPreviewEditorInput)]
);

class PdfPreviewContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.pdfPreview';

	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		super();
		this._register(editorResolverService.registerEditor(
			'*.pdf',
			{
				id: PdfPreviewEditor.ID,
				label: localize('pdfPreview', 'PDF 预览'),
				priority: RegisteredEditorPriority.builtin
			},
			{},
			{ createEditorInput: ({ resource }) => ({ editor: new PdfPreviewEditorInput(resource) }) }
		));
	}
}

registerWorkbenchContribution2(PdfPreviewContribution.ID, PdfPreviewContribution, WorkbenchPhase.BlockStartup);
