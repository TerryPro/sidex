/*---------------------------------------------------------------------------------------------
 *  SideX: Text buffer used by text based custom editors.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';

/**
 * Keeps the text of one custom editor document in memory and persists it through
 * the file service when saved.
 */
export class CustomTextEditorModel {

	static async create(instantiationService: IInstantiationService, viewType: string, resource: URI): Promise<CustomTextEditorModel> {
		const fileService = instantiationService.invokeFunction(accessor => accessor.get(IFileService));
		const model = new CustomTextEditorModel(resource, viewType, fileService);
		await model.load();
		return model;
	}

	private _value = '';
	private _dirty = false;

	private readonly _onDidChange = new Emitter<string>();
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(
		readonly resource: URI,
		readonly viewType: string,
		private readonly _fileService: IFileService,
	) { }

	get value(): string {
		return this._value;
	}

	isDirty(): boolean {
		return this._dirty;
	}

	update(value: string): void {
		if (this._value === value) {
			return;
		}
		this._value = value;
		this._dirty = true;
		this._onDidChange.fire(value);
	}

	async load(): Promise<void> {
		try {
			const content = await this._fileService.readFile(this.resource);
			this._value = content.value.toString();
			this._dirty = false;
		} catch {
			this._value = '';
			this._dirty = false;
		}
	}

	async save(): Promise<void> {
		await this._fileService.writeFile(this.resource, VSBuffer.fromString(this._value));
		this._dirty = false;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
