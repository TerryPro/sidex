/*---------------------------------------------------------------------------------------------
 *  SideX: 内置 CSV 表格预览的编辑器输入
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorModel } from '../../../common/editor/editorModel.js';
import { CsvPreviewEditor } from './csvPreviewEditor.js';

export class CsvPreviewEditorInput extends EditorInput {

	static readonly TYPE_ID = 'workbench.editors.csvPreviewInput';

	override get typeId(): string {
		return CsvPreviewEditorInput.TYPE_ID;
	}

	override get editorId(): string {
		return CsvPreviewEditor.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Singleton;
	}

	constructor(readonly resource: URI) {
		super();
	}

	override getName(): string {
		return basename(this.resource);
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof CsvPreviewEditorInput && other.resource.toString() === this.resource.toString();
	}

	override async resolve(): Promise<EditorModel> {
		return new EditorModel();
	}
}
