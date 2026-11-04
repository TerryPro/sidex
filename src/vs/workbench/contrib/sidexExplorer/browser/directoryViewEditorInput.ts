/*---------------------------------------------------------------------------------------------
 *  SideX — 主区域「文件列表」编辑器输入
 *
 *  全局只有一个实例：内容跟随当前活动的目录标签，内部视图缓存由
 *  DirectoryViewEditor 按 tabId 维护，切换标签不会创建新的编辑器标签。
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorModel } from '../../../common/editor/editorModel.js';
import { localize } from '../../../../nls.js';
import { DirectoryViewEditor } from './directoryViewEditor.js';

export class DirectoryViewEditorInput extends EditorInput {

	static readonly TYPE_ID = 'workbench.editors.sidexDirectoryViewInput';

	private label = localize('sidex.directory.fileList', '文件列表');

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
		return this.label;
	}

	/** 标签栏显示的标题跟随当前目录标签。 */
	setLabel(label: string): void {
		if (this.label === label) {
			return;
		}
		this.label = label;
		this._onDidChangeLabel.fire();
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof DirectoryViewEditorInput;
	}

	override async resolve(): Promise<EditorModel> {
		return new EditorModel();
	}
}
