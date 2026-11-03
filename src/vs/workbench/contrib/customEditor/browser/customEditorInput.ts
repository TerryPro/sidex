/*---------------------------------------------------------------------------------------------
 *  SideX: Custom editor input backed by a webview.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import {
	EditorInputCapabilities,
	GroupIdentifier,
	IRevertOptions,
	ISaveOptions,
	IUntypedEditorInput,
} from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { ICustomEditorModel, ICustomEditorProvider } from '../common/customEditor.js';

export interface CustomEditorInputInitInfo {
	readonly resource: URI;
	readonly viewType: string;
	readonly providerId: string;
	readonly name: string;
}

export class CustomEditorInput extends WebviewInput {

	static readonly ID = 'workbench.editors.customEditor';

	private readonly _resource: URI;
	private readonly _model: ICustomEditorModel;
	private readonly _provider: ICustomEditorProvider;

	private _resolved = false;

	constructor(
		init: CustomEditorInputInitInfo,
		webview: IOverlayWebview,
		model: ICustomEditorModel,
		provider: ICustomEditorProvider,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService,
	) {
		super(
			{ viewType: init.viewType, providedId: init.providerId, name: init.name, iconPath: undefined },
			webview,
			themeService,
		);

		this._resource = init.resource;
		this._model = model;
		this._provider = provider;

		this._register(this._model.onDidChangeDirty(() => {
			this._onDidChangeDirty.fire();
			this._onDidChangeLabel.fire();
		}));
		this._register(this._model.onDidChangeContent(() => {
			this._onDidChangeLabel.fire();
		}));

		// The webview runs in its own document. If it fails, keep the workbench
		// alive and offer a way back instead of leaving a dead tab.
		this._register(this.webview.onFatalError(event => {
			this._resolved = false;
			notificationService.prompt(
				Severity.Error,
				`自定义编辑器加载失败：${event.message}`,
				[{
					label: '重新加载',
					run: () => {
						this.webview.reload();
						this.resolve();
					},
				}],
			);
		}));
	}

	override get typeId(): string {
		return CustomEditorInput.ID;
	}

	override get resource(): URI {
		return this._resource;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.CanDropIntoEditor;
	}

	get model(): ICustomEditorModel {
		return this._model;
	}

	override isDirty(): boolean {
		return this._model.isDirty();
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		if (other instanceof CustomEditorInput) {
			return other.viewType === this.viewType && other.resource.toString() === this._resource.toString();
		}
		return false;
	}

	override async resolve(): Promise<IDisposable | null> {
		if (this._resolved) {
			return null;
		}
		this._resolved = true;
		try {
			await this._provider.resolveCustomEditor(this._model, this.webview);
		} catch (error) {
			console.error(`[customEditor] resolve failed for ${this._resource.toString()}`, error);
		}
		return null;
	}

	override async save(_group: GroupIdentifier, _options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		await this._model.save();
		return this;
	}

	override async revert(_group: GroupIdentifier, _options?: IRevertOptions): Promise<void> {
		await this._model.revert();
	}
}
