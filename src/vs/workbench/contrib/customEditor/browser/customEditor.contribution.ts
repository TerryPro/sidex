/*---------------------------------------------------------------------------------------------
 *  SideX: Custom editor contribution.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorExtensions, IEditorFactoryRegistry, isEditorInputWithOptionsAndGroup } from '../../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { globMatchesResource, IEditorResolverService } from '../../../services/editor/common/editorResolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CustomEditorInput } from './customEditorInput.js';
import { CustomEditorInputSerializer } from './customEditorInputFactory.js';
import { CustomEditorPane } from './customEditorPane.js';
import { CustomEditorService } from './customEditorService.js';
import { ICustomEditorService } from '../common/customEditor.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CustomEditorPane, CustomEditorPane.ID, localize('customEditor', "自定义编辑器")),
	[new SyncDescriptor(CustomEditorInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	CustomEditorInputSerializer.ID,
	CustomEditorInputSerializer
);

registerSingleton(ICustomEditorService, CustomEditorService, InstantiationType.Delayed);

/**
 * `activeCustomEditorId` is the standard VS Code context key used by extensions
 * to target editor title menus at one specific custom editor.
 */
const ActiveCustomEditorIdContext = new RawContextKey<string | undefined>('activeCustomEditorId', undefined, {
	type: 'string',
	description: localize('activeCustomEditorId', "The view type of the active custom editor")
});

class CustomEditorContextKeys extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.customEditorContextKeys';

	constructor(
		@IEditorService editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		const activeCustomEditorId = ActiveCustomEditorIdContext.bindTo(contextKeyService);
		const update = () => {
			const activeEditor = editorService.activeEditor;
			if (activeEditor instanceof CustomEditorInput) {
				activeCustomEditorId.set(activeEditor.viewType);
			} else {
				activeCustomEditorId.reset();
			}
		};

		this._register(editorService.onDidActiveEditorChange(update));
		update();
	}
}

registerWorkbenchContribution2(CustomEditorContextKeys.ID, CustomEditorContextKeys, WorkbenchPhase.BlockStartup);

/** Replaces the active editor with the same resource opened by `viewType`. */
async function replaceActiveEditorWith(accessor: ServicesAccessor, viewType: string): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const editorGroupsService = accessor.get(IEditorGroupsService);
	const editorResolverService = accessor.get(IEditorResolverService);

	const activeEditor = editorService.activeEditor;
	const resource = activeEditor?.resource;
	const group = editorGroupsService.activeGroup;
	if (!activeEditor || !resource || !group) {
		return;
	}

	// Custom editors have no untyped representation, so resolve the target
	// input explicitly and replace the tab in place.
	const resolved = await editorResolverService.resolveEditor({ resource, options: { override: viewType } }, group);
	if (!isEditorInputWithOptionsAndGroup(resolved)) {
		return;
	}

	await group.replaceEditors([{
		editor: activeEditor,
		replacement: resolved.editor,
		forceReplaceDirty: false,
		options: resolved.options
	}]);
	await group.openEditor(resolved.editor, resolved.options);
}

CommandsRegistry.registerCommand('sidex.customEditor.openMatchingEditor', async accessor => {
	const editorService = accessor.get(IEditorService);
	const customEditorService = accessor.get(ICustomEditorService);

	const resource = editorService.activeEditor?.resource;
	if (!resource) {
		return;
	}

	const provider = customEditorService.getEditorProviders().find(candidate =>
		candidate.filenamePatterns.some(pattern => globMatchesResource(pattern, resource))
	);
	if (!provider) {
		return;
	}

	await replaceActiveEditorWith(accessor, provider.viewType);
});

CommandsRegistry.registerCommand('sidex.customEditor.openAsText', async accessor => {
	await replaceActiveEditorWith(accessor, DEFAULT_EDITOR_ASSOCIATION.id);
});
