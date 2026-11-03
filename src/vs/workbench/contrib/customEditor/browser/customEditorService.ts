/*---------------------------------------------------------------------------------------------
 *  SideX: Custom editor service.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { basenameOrAuthority, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorResolverService } from '../../../services/editor/common/editorResolverService.js';
import { IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { CustomEditorInput } from './customEditorInput.js';
import { CustomEditorModel } from './customEditorModel.js';
import { ICustomEditorModel, ICustomEditorProvider, ICustomEditorService } from '../common/customEditor.js';

function modelKey(viewType: string, resource: URI): string {
	return `${viewType}:${resource.toString()}`;
}

export class CustomEditorService extends Disposable implements ICustomEditorService {

	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, ICustomEditorProvider>();
	private readonly _models = new Map<string, ICustomEditorModel>();
	private readonly _registrations = new Map<string, IDisposable[]>();

	/**
	 * Placeholder for the ported `mainThreadCustomEditors` bridge. It is only
	 * exercised when the standard VS Code extension host drives custom editors.
	 */
	readonly models: any = {
		disposeAllModelsForView: () => { },
		tryRetain: () => undefined,
		add: () => undefined,
		get: async () => undefined,
		getAllModels: async () => [] as unknown[],
	};

	private readonly _onDidChangeCustomEditors = this._register(new Emitter<void>());
	readonly onDidChangeCustomEditors: Event<void> = this._onDidChangeCustomEditors.event;

	constructor(
		@IEditorResolverService private readonly _editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	registerEditorProvider(provider: ICustomEditorProvider): IDisposable {
		if (this._providers.has(provider.viewType)) {
			throw new Error(`A custom editor provider is already registered for '${provider.viewType}'`);
		}

		this._providers.set(provider.viewType, provider);

		const registrations: IDisposable[] = [];
		// Associated file patterns come from the extension manifest; a provider
		// without them is only reachable through an explicit "open with".
		const patterns = provider.filenamePatterns;
		for (const pattern of patterns) {
			registrations.push(this._editorResolverService.registerEditor(
				pattern,
				{ id: provider.viewType, label: provider.displayName, priority: provider.priority },
				{ singlePerResource: !provider.supportsMultipleEditorsPerDocument },
				{
					createEditorInput: ({ resource }) => {
						const editor = this.createEditorInput(provider.viewType, resource);
						return editor ? { editor } : undefined;
					}
				}
			));
		}
		this._registrations.set(provider.viewType, registrations);
		this._onDidChangeCustomEditors.fire();

		this._logService.info(`[customEditor] registered '${provider.viewType}' (${patterns.join(', ')})`);

		return toDisposable(() => {
			for (const registration of this._registrations.get(provider.viewType) ?? []) {
				registration.dispose();
			}
			this._registrations.delete(provider.viewType);
			this._providers.delete(provider.viewType);
			this._onDidChangeCustomEditors.fire();
		});
	}

	getEditorProvider(viewType: string): ICustomEditorProvider | undefined {
		return this._providers.get(viewType);
	}

	getEditorProviders(): readonly ICustomEditorProvider[] {
		return Array.from(this._providers.values());
	}

	registerCustomEditorCapabilities(_viewType: string, _capabilities: any): any {
		return undefined;
	}

	async resolveEditor(resource: URI, viewType: string): Promise<ICustomEditorModel> {
		const provider = this._providers.get(viewType);
		if (!provider) {
			throw new Error(`No custom editor provider registered for '${viewType}'`);
		}
		return this.getOrCreateModel(provider, resource);
	}

	getModel(resource: URI, viewType: string): ICustomEditorModel | undefined {
		return this._models.get(modelKey(viewType, resource));
	}

	getModels(resource: URI): readonly ICustomEditorModel[] {
		const result: ICustomEditorModel[] = [];
		for (const model of this._models.values()) {
			if (model.resource.toString() === resource.toString()) {
				result.push(model);
			}
		}
		return result;
	}

	createEditorInput(viewType: string, resource: URI): EditorInput | undefined {
		const provider = this._providers.get(viewType);
		if (!provider) {
			this._logService.warn(`[customEditor] no provider for '${viewType}'`);
			return undefined;
		}

		const webview = this._webviewService.createWebviewOverlay({
			providedViewType: viewType,
			title: basenameOrAuthority(resource),
			options: {
				purpose: WebviewContentPurpose.CustomEditor,
				retainContextWhenHidden: true,
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [dirname(resource)],
			},
			extension: undefined,
		});

		const model = this.getOrCreateModel(provider, resource);

		return this._instantiationService.createInstance(
			CustomEditorInput,
			{
				resource,
				viewType,
				providerId: viewType,
				name: basenameOrAuthority(resource),
			},
			webview,
			model,
			provider,
		);
	}

	private getOrCreateModel(provider: ICustomEditorProvider, resource: URI): ICustomEditorModel {
		const key = modelKey(provider.viewType, resource);
		let model = this._models.get(key);
		if (!model) {
			model = new CustomEditorModel(provider, resource, provider.viewType);
			this._models.set(key, model);
		}
		return model;
	}
}
