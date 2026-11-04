/*---------------------------------------------------------------------------------------------
 *  SideX — 主区域「文件列表」编辑器输入
 *
 *  每个目录标签对应一个独立输入实例；工作台的编辑器面板在内部按标签维护独立视图，
 *  各自的 DOM、滚动位置互不影响。
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorModel } from '../../../common/editor/editorModel.js';
import { localize } from '../../../../nls.js';
import { DirectoryViewEditor } from './directoryViewEditor.js';

export class DirectoryViewEditorInput extends EditorInput {

	static readonly TYPE_ID = 'workbench.editors.sidexDirectoryViewInput';

	constructor(readonly tabId: string) {
		super();
	}

	override get resource(): URI | undefined {
		return undefined;
	}

	override get typeId(): string {
		return DirectoryViewEditorInput.TYPE_ID;
	}

	override get editorId(): string {
		return DirectoryViewEditor.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return localize('sidex.directory.fileList', '文件列表');
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof DirectoryViewEditorInput && other.tabId === this.tabId;
	}

	override async resolve(): Promise<EditorModel> {
		return new EditorModel();
	}
}
