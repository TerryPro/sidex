/*---------------------------------------------------------------------------------------------
 *  SideX: Serializes custom editor inputs across window reloads.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { CustomEditorInput } from './customEditorInput.js';
import { ICustomEditorService } from '../common/customEditor.js';

interface ISerializedCustomEditorInput {
	readonly resource: string;
	readonly viewType: string;
}

/**
 * Shape of the data a custom editor returns when backing up unsaved state.
 * Kept for the ported `mainThreadCustomEditors` bridge.
 */
export interface CustomDocumentBackupData {
	readonly viewType: string;
	readonly editorResource: unknown;
	backupId: string;
	readonly extension?: unknown;
	readonly customTitle?: string;
	readonly iconPath?: unknown;
	readonly webview?: unknown;
	[key: string]: unknown;
}

export class CustomEditorInputSerializer implements IEditorSerializer {

	static readonly ID = CustomEditorInput.ID;

	canSerialize(editor: EditorInput): boolean {
		return editor instanceof CustomEditorInput;
	}

	serialize(editor: EditorInput): string | undefined {
		if (!(editor instanceof CustomEditorInput)) {
			return undefined;
		}
		const data: ISerializedCustomEditorInput = {
			resource: editor.resource.toString(),
			viewType: editor.viewType,
		};
		return JSON.stringify(data);
	}

	deserialize(instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined {
		let data: ISerializedCustomEditorInput;
		try {
			data = JSON.parse(serializedEditor);
		} catch {
			return undefined;
		}
		if (!data?.resource || !data?.viewType) {
			return undefined;
		}
		return instantiationService.invokeFunction(accessor => {
			const service = accessor.get(ICustomEditorService);
			return service.createEditorInput(data.viewType, URI.parse(data.resource));
		});
	}
}
