/*---------------------------------------------------------------------------------------------
 *  SideX: Custom editor service contracts.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { EditorInput } from '../../../common/editor/editorInput.js';
import type { IWebview } from '../../webview/browser/webview.js';
import type { RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';

export const ICustomEditorService = createDecorator<ICustomEditorService>('customEditorService');

/**
 * A model owns the state of one custom editor document. The provider (usually an
 * extension bridge) decides how that state is loaded, saved and backed up.
 */
export interface ICustomEditorModel extends IDisposable {
	readonly resource: URI;
	readonly viewType: string;

	readonly onDidChangeDirty: Event<void>;
	readonly onDidChangeContent: Event<void>;

	isDirty(): boolean;
	setDirty?(dirty: boolean): void;

	save(): Promise<boolean>;
	revert(): Promise<void>;
	backup(...args: any[]): Promise<any>;
}

/**
 * Something that can render a resource inside a webview and persist it again.
 */
export interface ICustomEditorProvider {
	readonly viewType: string;
	readonly displayName: string;
	readonly filenamePatterns: readonly string[];
	readonly priority: RegisteredEditorPriority;
	readonly supportsMultipleEditorsPerDocument: boolean;

	resolveCustomEditor(model: ICustomEditorModel, webview: IWebview): Promise<void>;
	save(model: ICustomEditorModel): Promise<boolean>;
	revert(model: ICustomEditorModel): Promise<void>;
	backup(model: ICustomEditorModel): Promise<string | undefined>;
}

export interface ICustomEditorService {
	readonly _serviceBrand: undefined;

	/** Fired when a provider is registered or removed. */
	readonly onDidChangeCustomEditors: Event<void>;

	registerEditorProvider(provider: ICustomEditorProvider): IDisposable;
	getEditorProvider(viewType: string): ICustomEditorProvider | undefined;
	getEditorProviders(): readonly ICustomEditorProvider[];

	/** Creates (or reuses) the model for a resource and view type. */
	resolveEditor(resource: URI, viewType: string): Promise<ICustomEditorModel>;

	getModel(resource: URI, viewType: string): ICustomEditorModel | undefined;
	getModels(resource: URI): readonly ICustomEditorModel[];

	/**
	 * Model manager used by the ported extension-host bridge
	 * (`mainThreadCustomEditors`). Kept intentionally untyped until the full
	 * VS Code model manager is restored.
	 */
	readonly models: any;
	registerCustomEditorCapabilities(viewType: string, capabilities: any): any;

	/** Creates the editor input for a registered provider. */
	createEditorInput(viewType: string, resource: URI): EditorInput | undefined;
}
