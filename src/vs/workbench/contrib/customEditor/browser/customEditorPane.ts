/*---------------------------------------------------------------------------------------------
 *  SideX: Custom editor pane — a webview editor that hosts custom editor inputs.
 *--------------------------------------------------------------------------------------------*/

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { WebviewEditor } from '../../webviewPanel/browser/webviewEditor.js';

export class CustomEditorPane extends WebviewEditor {

	static readonly ID = 'workbench.editor.customEditor';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IWorkbenchLayoutService workbenchLayoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(group, telemetryService, themeService, storageService, editorGroupsService, editorService, workbenchLayoutService, hostService, contextKeyService);
	}
}
