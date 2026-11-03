/*---------------------------------------------------------------------------------------------
 *  SideX: Default custom editor model.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICustomEditorModel, ICustomEditorProvider } from '../common/customEditor.js';

export class CustomEditorModel extends Disposable implements ICustomEditorModel {

	private _dirty = false;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty: Event<void> = this._onDidChangeDirty.event;

	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	constructor(
		private readonly _provider: ICustomEditorProvider,
		readonly resource: URI,
		readonly viewType: string,
	) {
		super();
	}

	isDirty(): boolean {
		return this._dirty;
	}

	setDirty(dirty: boolean): void {
		if (this._dirty === dirty) {
			return;
		}
		this._dirty = dirty;
		this._onDidChangeDirty.fire();
	}

	notifyContentChanged(): void {
		this._onDidChangeContent.fire();
	}

	async save(): Promise<boolean> {
		const saved = await this._provider.save(this);
		if (saved) {
			this.setDirty(false);
		}
		return saved;
	}

	async revert(): Promise<void> {
		await this._provider.revert(this);
		this.setDirty(false);
	}

	backup(): Promise<string | undefined> {
		return this._provider.backup(this);
	}
}
