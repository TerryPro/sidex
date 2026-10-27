/*---------------------------------------------------------------------------------------------
 *  SideX: 内置 PDF 预览的编辑器输入
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorModel } from '../../../common/editor/editorModel.js';
import { PdfPreviewEditor } from './pdfPreviewEditor.js';

export class PdfPreviewEditorInput extends EditorInput {

	static readonly TYPE_ID = 'workbench.editors.pdfPreviewInput';

	override get typeId(): string {
		return PdfPreviewEditorInput.TYPE_ID;
	}

	override get editorId(): string {
		return PdfPreviewEditor.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	constructor(readonly resource: URI) {
		super();
	}

	override getName(): string {
		return basename(this.resource);
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PdfPreviewEditorInput && other.resource.toString() === this.resource.toString();
	}

	override async resolve(): Promise<EditorModel> {
		return new EditorModel();
	}
}
