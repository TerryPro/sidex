/*---------------------------------------------------------------------------------------------
 *  SideX — 资源管理器骨架：目录标签、导航视图、文件列表编辑器
 *--------------------------------------------------------------------------------------------*/

import './media/sidexExplorer.css';

import { Codicon } from '../../../../base/common/codicons.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry } from '../../../common/views.js';
import { VIEWLET_ID } from '../../files/common/files.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IDirectoryService } from './directoryService.js';
import { DirectoryViewEditor } from './directoryViewEditor.js';
import { DirectoryViewEditorInput } from './directoryViewEditorInput.js';
import { NavigationView } from './navigationView.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(DirectoryViewEditor, DirectoryViewEditor.ID, localize('sidex.directoryView', '文件列表')),
	[new SyncDescriptor(DirectoryViewEditorInput)]
);

// 复用内置「资源管理器」容器，不再新建面板。
try {
	const explorerContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).get(VIEWLET_ID);
	if (explorerContainer) {
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
			{
				id: NavigationView.ID,
				name: localize2('sidex.navigation.title', '此电脑'),
				containerIcon: Codicon.folder,
				ctorDescriptor: new SyncDescriptor(NavigationView),
				canToggleVisibility: false,
				canMoveView: false,
				order: 0
			}
		], explorerContainer);
	}
} catch (error) {
	console.error('[SideX] Failed to register navigation view', error);
}

class SidexExplorerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sidexExplorer';

	private readonly directoryEditors = new Map<string, DirectoryViewEditorInput>();

	constructor(
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IViewsService private readonly viewsService: IViewsService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();

		this._register(this.directoryService.onDidChange(() => void this.syncDirectoryEditors()));
		// 点击目录标签（包括已是激活状态的标签）时，把主区域切回该标签的文件列表。
		this._register(this.directoryService.onDidActivateTab(tabId => void this.activateDirectoryEditor(tabId)));

		this._register(this.editorService.onDidCloseEditor(event => {
			if (!(event.editor instanceof DirectoryViewEditorInput)) {
				return;
			}
			const tab = this.directoryService.getTab(event.editor.tabId);
			if (tab) {
				// 文件列表编辑器不允许被关闭，目录标签仍在时重新打开。
				void this.openDirectoryEditor(event.editor);
			} else {
				this.directoryEditors.delete(event.editor.tabId);
			}
		}));

		void this.initialize();
	}

	private async initialize(): Promise<void> {
		await this.directoryService.initialize();

		// 侧边栏只保留「此电脑」导航树；清掉历史布局里残留的大纲/时间线等视图与占位。
		this.resetExplorerContainer();

		if (this.directoryService.drivesError) {
			this.notificationService.warn(localize('sidex.drives.failedNotice', '读取驱动器失败：{0}', this.directoryService.drivesError));
		}

		try {
			// 初始布局：活动栏/侧边栏/编辑器/状态栏可见，底部面板与右侧辅助栏隐藏。
			this.layoutService.setPartHidden(false, Parts.ACTIVITYBAR_PART);
			this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
			this.layoutService.setPartHidden(false, Parts.STATUSBAR_PART);
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);
			this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);

			// 顶部菜单栏默认展开，和初始布局一致。
			const menuBarVisibility = this.configurationService.getValue<string>('window.menuBarVisibility');
			if (menuBarVisibility === 'hidden' || menuBarVisibility === 'compact') {
				void this.configurationService.updateValue('window.menuBarVisibility', 'classic', ConfigurationTarget.USER);
			}
		} catch (error) {
			this.notificationService.warn(localize('sidex.activityBar.failedNotice', '初始化布局失败：{0}', String(error)));
		}

		try {
			const composite = await this.viewsService.openViewContainer(VIEWLET_ID, false);
			if (!composite) {
				const registered = !!this.viewDescriptorService.getViewContainerById(VIEWLET_ID);
				this.notificationService.warn(localize('sidex.navigation.failedNotice', '导航视图打开失败（已注册：{0}）', registered ? '是' : '否'));
			}
		} catch (error) {
			this.notificationService.warn(localize('sidex.navigation.errorNotice', '导航视图打开异常：{0}', String(error)));
		}

		await this.closeRestoredEditors();
		await this.syncDirectoryEditors();
	}

	/** 侧边栏容器只允许存在「此电脑」视图，避免旧布局留下空白区域。 */
	private resetExplorerContainer(): void {
		const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).get(VIEWLET_ID);
		if (container) {
			const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
			const extraViews = viewsRegistry.getViews(container).filter(view => view.id !== NavigationView.ID);
			if (extraViews.length) {
				viewsRegistry.deregisterViews(extraViews, container);
			}
		}

		// 旧布局会为已移除的视图保留高度，表现为文件浏览器下方的一块灰色空白；重置后重新计算。
		this.storageService.remove('workbench.view.explorer.numberOfVisibleViews', StorageScope.WORKSPACE);
		this.storageService.remove('workbench.explorer.views.state', StorageScope.WORKSPACE);

		// 清掉已删除的源代码管理/时间线功能留下的布局状态。
		for (const key of [
			'workbench.scm.views.state',
			'workbench.scm.state',
			'scm.viewState2',
			'scm:view:visibleRepositories',
			'scm.graphView.referencesFilter',
			'workbench.view.scm.numberOfVisibleViews'
		]) {
			this.storageService.remove(key, StorageScope.WORKSPACE);
		}
	}

	/** 启动时清掉上一次会话恢复出来的编辑器，让主区域只显示「文件列表」。未保存内容保留。 */
	private async closeRestoredEditors(): Promise<void> {
		for (const group of this.editorGroupsService.groups) {
			for (const editor of [...group.editors]) {
				if (editor instanceof DirectoryViewEditorInput || editor.isDirty()) {
					continue;
				}
				try {
					await group.closeEditor(editor, { preserveFocus: true });
				} catch {
					// 关闭失败时保留该编辑器，不影响启动
				}
			}
		}
	}

	/** 让每个目录标签拥有自己的文件列表编辑器实例。 */
	private async syncDirectoryEditors(): Promise<void> {
		const tabIds = new Set(this.directoryService.tabs.map(tab => tab.id));

		for (const [tabId, input] of [...this.directoryEditors]) {
			if (!tabIds.has(tabId)) {
				this.directoryEditors.delete(tabId);
				await this.closeDirectoryEditor(input);
			}
		}

		const activeTab = this.directoryService.activeTab;
		if (!activeTab) {
			return;
		}

		// 标签切换（含关闭标签后的自动切换）或主区域被文件占用时，激活当前标签的文件列表。
		const activeEditor = this.editorService.activeEditor;
		const showingActiveTab = activeEditor instanceof DirectoryViewEditorInput && activeEditor.tabId === activeTab.id;
		if (!showingActiveTab) {
			await this.activateDirectoryEditor(activeTab.id);
		}
	}

	/** 打开并激活指定标签的编辑器。 */
	private async activateDirectoryEditor(tabId: string): Promise<void> {
		let input = this.directoryEditors.get(tabId);
		if (!input) {
			input = new DirectoryViewEditorInput(tabId);
			this.directoryEditors.set(tabId, input);
		}
		await this.openDirectoryEditor(input);
	}

	private async openDirectoryEditor(input: DirectoryViewEditorInput): Promise<void> {
		try {
			await this.editorService.openEditor(input, { pinned: true, index: 0 });
		} catch (error) {
			// 快速连续切换标签时，上一次打开操作会被取消，属于正常流程。
			if (!isCancellationError(error)) {
				throw error;
			}
		}
	}

	private async closeDirectoryEditor(input: DirectoryViewEditorInput): Promise<void> {
		for (const group of this.editorGroupsService.groups) {
			if (!group.editors.includes(input)) {
				continue;
			}
			try {
				await group.closeEditor(input, { preserveFocus: true });
			} catch {
				// 关闭失败时保留编辑器，不影响标签切换
			}
		}
	}
}

registerWorkbenchContribution2(SidexExplorerContribution.ID, SidexExplorerContribution, WorkbenchPhase.AfterRestored);
