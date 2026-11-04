/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { ITelemetryData } from '../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceFolder } from '../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../services/workspaces/common/workspaceEditing.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import {
	ADD_ROOT_FOLDER_COMMAND_ID,
	ADD_ROOT_FOLDER_LABEL,
	PICK_WORKSPACE_FOLDER_COMMAND_ID,
	SET_ROOT_FOLDER_COMMAND_ID
} from './workspaceCommands.js';
import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { MenuRegistry, MenuId, Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import {
	EmptyWorkspaceSupportContext,
	EnterMultiRootWorkspaceSupportContext,
	OpenFolderWorkspaceSupportContext,
	WorkbenchStateContext,
	WorkspaceFolderCountContext
} from '../../common/contextkeys.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IHostService } from '../../services/host/browser/host.js';
import { KeyChord, KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { IsMacNativeContext } from '../../../platform/contextkey/common/contextkeys.js';
import { ILocalizedString } from '../../../platform/action/common/action.js';
import { Categories } from '../../../platform/action/common/actionCommonCategories.js';

const workspacesCategory: ILocalizedString = localize2('workspaces', 'Workspaces');

export class OpenFileAction extends Action2 {
	static readonly ID = 'workbench.action.files.openFile';

	constructor() {
		super({
			id: OpenFileAction.ID,
			title: localize2('openFile', 'Open File...'),
			category: Categories.File,
			f1: true,
			keybinding: {
				when: IsMacNativeContext.toNegated(),
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyO
			}
		});
	}

	override async run(accessor: ServicesAccessor, data?: ITelemetryData): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);

		return fileDialogService.pickFileAndOpen({ forceNewWindow: false, telemetryExtraData: data });
	}
}

export class OpenFolderAction extends Action2 {
	static readonly ID = 'workbench.action.files.openFolder';

	constructor() {
		super({
			id: OpenFolderAction.ID,
			title: localize2('openFolder', 'Open Folder...'),
			category: Categories.File,
			f1: true,
			precondition: OpenFolderWorkspaceSupportContext,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: undefined,
				linux: {
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyO)
				},
				win: {
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyO)
				}
			}
		});
	}

	override async run(accessor: ServicesAccessor, data?: ITelemetryData): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);

		return fileDialogService.pickFolderAndOpen({ forceNewWindow: false, telemetryExtraData: data });
	}
}

export class OpenFolderViaWorkspaceAction extends Action2 {
	// This action swaps the folders of a workspace with
	// the selected folder and is a workaround for providing
	// "Open Folder..." in environments that do not support
	// this without having a workspace open (e.g. web serverless)

	static readonly ID = 'workbench.action.files.openFolderViaWorkspace';

	constructor() {
		super({
			id: OpenFolderViaWorkspaceAction.ID,
			title: localize2('openFolder', 'Open Folder...'),
			category: Categories.File,
			f1: true,
			precondition: ContextKeyExpr.and(
				OpenFolderWorkspaceSupportContext.toNegated(),
				WorkbenchStateContext.isEqualTo('workspace')
			),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyO
			}
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);

		return commandService.executeCommand(SET_ROOT_FOLDER_COMMAND_ID);
	}
}

export class OpenFileFolderAction extends Action2 {
	static readonly ID = 'workbench.action.files.openFileFolder';
	static readonly LABEL: ILocalizedString = localize2('openFileFolder', 'Open...');

	constructor() {
		super({
			id: OpenFileFolderAction.ID,
			title: OpenFileFolderAction.LABEL,
			category: Categories.File,
			f1: true,
			precondition: ContextKeyExpr.and(IsMacNativeContext, OpenFolderWorkspaceSupportContext),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyO
			}
		});
	}

	override async run(accessor: ServicesAccessor, data?: ITelemetryData): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);

		return fileDialogService.pickFileFolderAndOpen({ forceNewWindow: false, telemetryExtraData: data });
	}
}

class CloseWorkspaceAction extends Action2 {
	static readonly ID = 'workbench.action.closeFolder';

	constructor() {
		super({
			id: CloseWorkspaceAction.ID,
			title: localize2('closeWorkspace', 'Close Workspace'),
			category: workspacesCategory,
			f1: true,
			precondition: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('empty'), EmptyWorkspaceSupportContext),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyF)
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const hostService = accessor.get(IHostService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);

		return hostService.openWindow({ forceReuseWindow: true, remoteAuthority: environmentService.remoteAuthority });
	}
}

export class AddRootFolderAction extends Action2 {
	static readonly ID = 'workbench.action.addRootFolder';

	constructor() {
		super({
			id: AddRootFolderAction.ID,
			title: ADD_ROOT_FOLDER_LABEL,
			precondition: ContextKeyExpr.or(
				EnterMultiRootWorkspaceSupportContext,
				WorkbenchStateContext.isEqualTo('workspace')
			)
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);

		return commandService.executeCommand(ADD_ROOT_FOLDER_COMMAND_ID);
	}
}

export class RemoveRootFolderAction extends Action2 {
	static readonly ID = 'workbench.action.removeRootFolder';

	constructor() {
		super({
			id: RemoveRootFolderAction.ID,
			title: localize2('globalRemoveFolderFromWorkspace', 'Remove Folder from Workspace...'),
			precondition: ContextKeyExpr.and(
				WorkspaceFolderCountContext.notEqualsTo('0'),
				ContextKeyExpr.or(EnterMultiRootWorkspaceSupportContext, WorkbenchStateContext.isEqualTo('workspace'))
			)
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const workspaceEditingService = accessor.get(IWorkspaceEditingService);

		const folder = await commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
		if (folder) {
			await workspaceEditingService.removeFolders([folder.uri]);
		}
	}
}

// --- Actions Registration

registerAction2(AddRootFolderAction);
registerAction2(RemoveRootFolderAction);
registerAction2(OpenFileAction);
registerAction2(OpenFolderAction);
registerAction2(OpenFolderViaWorkspaceAction);
registerAction2(OpenFileFolderAction);
registerAction2(CloseWorkspaceAction);

// --- Menu Registration

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '2_open',
	command: {
		id: OpenFileAction.ID,
		title: localize({ key: 'miOpenFile', comment: ['&& denotes a mnemonic'] }, '&&Open File...')
	},
	order: 1,
	when: IsMacNativeContext.toNegated()
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '2_open',
	command: {
		id: OpenFolderAction.ID,
		title: localize({ key: 'miOpenFolder', comment: ['&& denotes a mnemonic'] }, 'Open &&Folder...')
	},
	order: 2,
	when: OpenFolderWorkspaceSupportContext
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '2_open',
	command: {
		id: OpenFolderViaWorkspaceAction.ID,
		title: localize({ key: 'miOpenFolder', comment: ['&& denotes a mnemonic'] }, 'Open &&Folder...')
	},
	order: 2,
	when: ContextKeyExpr.and(OpenFolderWorkspaceSupportContext.toNegated(), WorkbenchStateContext.isEqualTo('workspace'))
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '2_open',
	command: {
		id: OpenFileFolderAction.ID,
		title: localize({ key: 'miOpen', comment: ['&& denotes a mnemonic'] }, '&&Open...')
	},
	order: 1,
	when: ContextKeyExpr.and(IsMacNativeContext, OpenFolderWorkspaceSupportContext)
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '6_close',
	command: {
		id: CloseWorkspaceAction.ID,
		title: localize({ key: 'miCloseFolder', comment: ['&& denotes a mnemonic'] }, 'Close &&Folder')
	},
	order: 3,
	when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('folder'), EmptyWorkspaceSupportContext)
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '6_close',
	command: {
		id: CloseWorkspaceAction.ID,
		title: localize({ key: 'miCloseWorkspace', comment: ['&& denotes a mnemonic'] }, 'Close &&Workspace')
	},
	order: 3,
	when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('workspace'), EmptyWorkspaceSupportContext)
});
