/*---------------------------------------------------------------------------------------------
 *  SideX — 资源管理器骨架：目录标签、导航视图、文件列表编辑器
 *
 *  标签语义（目录标签私有工作集）：
 *  - 顶部目录标签是会话标签，每个标签拥有自己的文件列表、打开文件集合与活动文件；
 *  - 主区域的「文件列表」只有一个编辑器标签，内容跟随当前目录标签；
 *  - 切换目录标签时保存/恢复该标签的工作集，未保存的文件在切换前自动保存。
 *--------------------------------------------------------------------------------------------*/

import './media/sidexExplorer.css';

import { Codicon } from '../../../../base/common/codicons.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, EditorInputCapabilities, EditorsOrder, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { VIEWLET_ID } from '../../files/common/files.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
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
import { SideXPreviewPane } from './previewPane.js';

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

// 右侧辅助栏：单击文件时显示预览与属性。
const PREVIEW_CONTAINER_ID = 'sidex.previewContainer';
const previewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer(
	{
		id: PREVIEW_CONTAINER_ID,
		title: localize2('sidex.preview.containerTitle', '预览'),
		icon: Codicon.eye,
		order: 0,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PREVIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		rejectAddedViews: true
	},
	ViewContainerLocation.AuxiliaryBar
);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: SideXPreviewPane.ID,
		name: localize2('sidex.preview.viewTitle', '预览与属性'),
		containerIcon: Codicon.eye,
		ctorDescriptor: new SyncDescriptor(SideXPreviewPane),
		canToggleVisibility: false,
		canMoveView: false,
		order: 0
	}
], previewContainer);

/** 切换时收集到的实时编辑器（关闭前需要 EditorInput 引用来保存/关闭）。 */
interface LiveEditor {
	readonly editor: EditorInput;
	readonly groupId: number;
	readonly pinned: boolean;
	/** 能否用 untyped 描述符在工作集切回时重建。 */
	restorable: boolean;
}

/** 工作集中的编辑器，使用描述符保存，关闭后仍可重建。 */
interface SessionEditor {
	readonly input: IUntypedEditorInput;
	readonly groupId: number;
	readonly pinned: boolean;
}

/** 一个目录标签的编辑器工作集。 */
interface DirectoryEditorSession {
	readonly editors: readonly SessionEditor[];
	readonly activeIndex: number | undefined;
}

/** 切换目录标签的结果。 */
type SessionSwitchResult =
	| 'restored-file'
	| 'restored-list'
	| 'blocked';

class SidexExplorerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sidexExplorer';

	/** 全局唯一的文件列表编辑器：内部按目录标签缓存视图，不随标签切换新建编辑器。 */
	private listInput = this.createListInput();
	/** 每个目录标签的工作集。 */
	private readonly sessions = new Map<string, DirectoryEditorSession>();
	private knownTabIds = new Set<string>();
	private lastActiveTabId: string | undefined;
	private lastActiveLocation: string | undefined;
	private syncQueue: Promise<void> = Promise.resolve();
	private disposed = false;

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

		this._register(this.directoryService.onDidChange(() => this.scheduleSync()));
		this._register(this.directoryService.onDidChangeSelection(() => this.revealPreviewPane()));
		this._register(this.editorService.onDidCloseEditor(event => {
			if (this.disposed || !(event.editor instanceof DirectoryViewEditorInput)) {
				return;
			}
			// 文件列表标签不允许被关闭；目录标签仍在时恢复，但不打断当前编辑器。
			if (this.directoryService.activeTab) {
				void this.openListEditor(false);
			}
		}));

		void this.initialize();
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
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

	/** 单击文件后展开右侧辅助栏；辅助栏一旦显示就保持可见，由用户手动关闭。 */
	private revealPreviewPane(): void {
		if (!this.directoryService.getSelection()) {
			return;
		}
		try {
			this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		} catch (error) {
			console.error('[SideX] Failed to show preview pane', error);
		}
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

	/** 串行化目录变更，避免快速切换标签时工作集互相覆盖。 */
	private scheduleSync(): void {
		if (this.disposed) {
			return;
		}
		this.syncQueue = this.syncQueue
			.then(() => this.syncDirectoryEditors())
			.catch(error => console.error('[SideX] sync directory editors failed', error));
	}

	/** 目录标签变化时同步文件列表与工作集，不抢占正在编辑的文件。 */
	private async syncDirectoryEditors(): Promise<void> {
		const tabs = this.directoryService.tabs;
		const tabIds = new Set(tabs.map(tab => tab.id));
		const removedTabIds = [...this.knownTabIds].filter(id => !tabIds.has(id));
		this.knownTabIds = tabIds;

		const activeTab = this.directoryService.activeTab;
		if (!activeTab) {
			for (const tabId of removedTabIds) {
				this.sessions.delete(tabId);
			}
			return;
		}

		const previousTabId = this.lastActiveTabId;
		const tabChanged = previousTabId !== undefined && previousTabId !== activeTab.id;
		const locationChanged = this.lastActiveLocation !== activeTab.location;

		let switchResult: SessionSwitchResult = 'restored-list';
		if (tabChanged) {
			switchResult = await this.switchSession(previousTabId, activeTab.id);
			if (switchResult === 'blocked') {
				if (tabIds.has(previousTabId)) {
					// 保存未通过时取消切换，让用户先处理未保存内容。
					this.directoryService.activateTab(previousTabId);
					return;
				}
				// 原标签已被关闭，无法回退；保留尚未保存的编辑器，继续切换。
				this.notificationService.warn(localize('sidex.directory.leaveUnsaved', '部分文件未能保存，已保留在编辑区。'));
				switchResult = 'restored-list';
			}
		}

		this.lastActiveTabId = activeTab.id;
		this.lastActiveLocation = activeTab.location;
		// 列表标题跟随当前目录标签，切换标签后仍在标签栏中可辨认。
		if (!this.listInput.isDisposed()) {
			this.listInput.setLabel(localize('sidex.directory.fileListOf', '文件列表 — {0}', activeTab.title));
		}

		// 关闭已删除目录标签的工作集；若它正是刚才切换走的标签，切换时已处理。
		for (const tabId of removedTabIds) {
			this.sessions.delete(tabId);
		}

		const restoredFile = tabChanged && switchResult === 'restored-file';
		if (!restoredFile && (tabChanged || locationChanged || !this.findGroup(this.listInput))) {
			await this.openListEditor();
		}
	}

	/** 保存当前标签的工作集，关闭其编辑器，再恢复目标标签的工作集。 */
	private async switchSession(fromTabId: string, toTabId: string): Promise<SessionSwitchResult> {
		const live = this.collectLiveEditors();
		const activeEditor = this.editorService.activeEditor;

		if (!await this.saveEditors(live)) {
			return 'blocked';
		}

		this.sessions.set(fromTabId, this.buildSession(live, activeEditor));
		await this.closeEditors(live);
		return this.restoreSession(toTabId);
	}

	private collectLiveEditors(): LiveEditor[] {
		const live: LiveEditor[] = [];
		for (const group of this.editorGroupsService.mainPart.groups) {
			for (const editor of group.getEditors(EditorsOrder.SEQUENTIAL)) {
				if (editor instanceof DirectoryViewEditorInput) {
					continue;
				}
				live.push({
					editor,
					groupId: group.id,
					pinned: editor !== group.previewEditor,
					restorable: true
				});
			}
		}
		return live;
	}

	/** 把实时编辑器转成可重建的描述符；不支持的编辑器保持打开，不参与工作集。 */
	private buildSession(live: LiveEditor[], activeEditor: EditorInput | null): DirectoryEditorSession {
		const editors: SessionEditor[] = [];
		let activeIndex: number | undefined;

		for (const entry of live) {
			let input: IUntypedEditorInput | undefined;
			try {
				input = entry.editor.toUntyped({ preserveViewState: entry.groupId });
			} catch (error) {
				console.error('[SideX] failed to serialize editor', error);
			}
			if (!input && entry.editor.resource) {
				// 自定义编辑器等未实现 toUntyped 的输入，用资源描述符重新走编辑器解析。
				input = { resource: entry.editor.resource };
			}
			if (!input) {
				entry.restorable = false;
				continue;
			}
			if (entry.editor === activeEditor) {
				activeIndex = editors.length;
			}
			editors.push({ input, groupId: entry.groupId, pinned: entry.pinned });
		}

		return { editors, activeIndex };
	}

	/** 切换前自动保存有路径的未保存文件；新建文件需要用户先手动保存。 */
	private async saveEditors(live: readonly LiveEditor[]): Promise<boolean> {
		const dirty = live.filter(entry => entry.editor.isDirty());
		if (!dirty.length) {
			return true;
		}

		if (dirty.some(entry => entry.editor.hasCapability(EditorInputCapabilities.Untitled))) {
			this.notificationService.warn(localize('sidex.directory.unsavedUntitled', '当前标签有未保存的新建文件，已取消切换。请先保存该文件。'));
			return false;
		}

		const identifiers: { editor: EditorInput; groupId: number }[] = dirty
			.filter(entry => this.groupFor(entry) !== undefined)
			.map(entry => ({ editor: entry.editor, groupId: entry.groupId }));
		if (!identifiers.length) {
			return true;
		}

		try {
			const result = await this.editorService.save(identifiers);
			if (!result.success) {
				this.notificationService.warn(localize('sidex.directory.saveFailed', '有文件保存失败，已取消切换。'));
				return false;
			}
		} catch (error) {
			this.notificationService.warn(localize('sidex.directory.saveError', '保存文件时出错，已取消切换：{0}', String(error)));
			return false;
		}
		return true;
	}

	private async closeEditors(live: readonly LiveEditor[]): Promise<void> {
		for (const entry of live) {
			if (!entry.restorable) {
				// 无法重建的编辑器保持打开，避免切换后丢失。
				continue;
			}
			const group = this.groupFor(entry);
			if (!group || !group.editors.includes(entry.editor)) {
				continue;
			}
			try {
				await group.closeEditor(entry.editor, { preserveFocus: true });
			} catch {
				// 编辑器已关闭或关闭被取消，忽略即可。
			}
		}
	}

	/** 恢复目标标签的编辑器；返回是否恢复了活动文件。 */
	private async restoreSession(tabId: string): Promise<SessionSwitchResult> {
		const session = this.sessions.get(tabId);
		if (!session || !session.editors.length) {
			return 'restored-list';
		}

		const groupIndexes = new Map<number, number>();
		for (const entry of session.editors) {
			const group = this.editorGroupsService.getGroup(entry.groupId) ?? this.editorGroupsService.mainPart.activeGroup;
			const index = (groupIndexes.get(group.id) ?? 0) + 1;
			groupIndexes.set(group.id, index);
			try {
				await this.editorService.openEditor(this.withOptions(entry.input, {
					pinned: entry.pinned,
					inactive: true,
					index
				}), group);
			} catch {
				// 单个编辑器恢复失败时跳过，不影响其余工作集。
			}
		}

		const sessionActiveIndex = session.activeIndex;
		if (sessionActiveIndex === undefined) {
			return 'restored-list';
		}
		const activeEntry = session.editors[sessionActiveIndex];
		if (!activeEntry) {
			return 'restored-list';
		}

		const group = this.editorGroupsService.getGroup(activeEntry.groupId) ?? this.editorGroupsService.mainPart.activeGroup;
		let activeIndex = 0;
		for (let index = 0; index <= sessionActiveIndex; index++) {
			if (session.editors[index].groupId === group.id) {
				activeIndex++;
			}
		}
		try {
			await this.editorService.openEditor(this.withOptions(activeEntry.input, {
				pinned: activeEntry.pinned,
				inactive: false,
				index: activeIndex
			}), group);
			return 'restored-file';
		} catch {
			return 'restored-list';
		}
	}

	private withOptions(input: IUntypedEditorInput, options: { pinned: boolean; inactive: boolean; index?: number }): IUntypedEditorInput {
		return {
			...input,
			options: {
				...input.options,
				...options
			}
		} as IUntypedEditorInput;
	}

	/** 打开文件列表标签；activate 为 false 时只恢复标签，不抢焦点。 */
	private async openListEditor(activate = true): Promise<void> {
		if (this.disposed) {
			return;
		}
		// 编辑器关闭后会释放输入实例，重新打开时创建一个新的。
		if (this.listInput.isDisposed()) {
			this.listInput = this.createListInput();
		}
		const activeTab = this.directoryService.activeTab;
		if (activeTab) {
			this.listInput.setLabel(localize('sidex.directory.fileListOf', '文件列表 — {0}', activeTab.title));
		}
		// 文件列表固定在主编辑组，避免分栏后在多个组之间漂移。
		const group = this.findGroup(this.listInput)
			?? this.editorGroupsService.mainPart.groups[0]
			?? this.editorGroupsService.mainPart.activeGroup;
		try {
			await this.editorService.openEditor(this.listInput, {
				pinned: true,
				index: 0,
				inactive: !activate,
				preserveFocus: !activate
			}, group);
		} catch (error) {
			// 快速连续切换标签时，上一次打开操作会被取消，属于正常流程。
			if (!isCancellationError(error)) {
				throw error;
			}
		}
	}

	private findGroup(editor: EditorInput): IEditorGroup | undefined {
		return this.editorGroupsService.mainPart.groups.find(group => group.editors.includes(editor));
	}

	private createListInput(): DirectoryViewEditorInput {
		return this._register(new DirectoryViewEditorInput());
	}

	private groupFor(entry: { editor: EditorInput; groupId: number }): IEditorGroup | undefined {
		return this.editorGroupsService.getGroup(entry.groupId) ?? this.findGroup(entry.editor);
	}
}

registerWorkbenchContribution2(SidexExplorerContribution.ID, SidexExplorerContribution, WorkbenchPhase.AfterRestored);
