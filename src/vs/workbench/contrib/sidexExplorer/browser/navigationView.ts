/*---------------------------------------------------------------------------------------------
 *  SideX — 资源管理器导航面板（此电脑 + 驱动器 + 可展开文件夹）
 *
 *  复用内置「资源管理器」容器，行为对齐 Windows 资源管理器左侧导航树：
 *  - 根节点「此电脑」列出所有驱动器
 *  - 展开驱动器/文件夹时惰性读取子文件夹
 *  - 点击名称导航主区域，点击箭头只展开/折叠
 *
 *  每个目录标签拥有自己的一棵导航树，展开状态、子目录缓存、选中项与滚动位置互相隔离；
 *  切换标签时只切换显示，不重建其他标签的树。
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, reset } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { toAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ISideXExplorerService } from '../../../../platform/sidex/common/sidexExplorerService.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IDirectoryService, normalizeLocation } from './directoryService.js';
import { driveIconSvg, folderIconSvg, pcIconSvg } from './explorerIcons.js';

type NavigationNodeKind = 'this-pc' | 'drive' | 'folder';

interface INavigationNode {
	readonly path: string;
	readonly name: string;
	readonly kind: NavigationNodeKind;
	readonly depth: number;
}

/** 一个目录标签对应的独立导航树。 */
interface NavigationTabState {
	readonly tabId: string;
	readonly tree: HTMLElement;
	readonly scrollable: DomScrollableElement;
	readonly scrollableNode: HTMLElement;
	readonly renderDisposables: DisposableStore;
	readonly expandedPaths: Set<string>;
	readonly childrenByPath: Map<string, INavigationNode[]>;
	readonly loadingPaths: Set<string>;
	revealToken: number;
	revealedLocation: string | undefined;
	renderedRefreshToken: number;
	needsRender: boolean;
}

export class NavigationView extends ViewPane {

	static readonly ID = 'sidex.view.navigation';

	private viewsRoot: HTMLElement | undefined;
	private placesHost: HTMLElement | undefined;
	private readonly states = new Map<string, NavigationTabState>();
	private activeTabId: string | undefined;
	private readonly viewDisposables = this._register(new DisposableStore());
	private readonly placesDisposables = this._register(new DisposableStore());

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this.viewDisposables.add(this.directoryService.onDidChange(() => {
			this.syncTabs();
			this.renderPlaces();
		}));
		this.viewDisposables.add(this.directoryService.onDidChangeDrives(() => this.onDrivesChange()));
		this.viewDisposables.add(this.directoryService.onDidChangePlaces(() => this.renderPlaces()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const root = append(container, $('.sidex-navigation-view'));
		this.placesHost = append(root, $('.sidex-navigation-places'));
		this.viewsRoot = append(root, $('.sidex-navigation-views'));

		// 视图可能在标签创建之后才渲染，把已建好的树挂回容器。
		for (const state of this.states.values()) {
			this.viewsRoot.appendChild(state.scrollableNode);
		}

		this.renderPlaces();
		this.syncTabs();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.activeState?.scrollable.scanDomNode();
	}

	/** 渲染收藏与最近目录入口，固定显示在导航树上方。 */
	private renderPlaces(): void {
		const host = this.placesHost;
		if (!host) {
			return;
		}
		this.placesDisposables.clear();
		reset(host);
		this.renderPlaceSection(
			host,
			localize('sidex.places.favorites', '收藏'),
			this.directoryService.favorites,
			true
		);
		this.renderPlaceSection(
			host,
			localize('sidex.places.recent', '最近'),
			this.directoryService.recentLocations,
			false
		);
	}

	private renderPlaceSection(
		parent: HTMLElement,
		title: string,
		locations: readonly string[],
		favorite: boolean
	): void {
		if (!locations.length) {
			return;
		}
		const section = append(parent, $('.sidex-navigation-section'));
		const header = append(section, $('.sidex-navigation-section-header'));
		header.textContent = title;

		const activeLocation = normalizeLocation(this.directoryService.activeLocation).toLowerCase();
		for (const location of locations) {
			const row = append(section, $('.sidex-navigation-place'));
			row.tabIndex = 0;
			if (normalizeLocation(location).toLowerCase() === activeLocation) {
				row.classList.add('active');
			}

			const icon = append(row, $('span.sidex-navigation-place-icon'));
			icon.classList.add('codicon', favorite ? Codicon.starFull.id : Codicon.history.id);

			const label = append(row, $('span.sidex-navigation-place-label'));
			label.textContent = this.directoryService.titleForLocation(location);
			label.title = location;

			const remove = append(row, $('span.sidex-navigation-place-remove'));
			remove.textContent = '×';
			remove.title = localize('sidex.places.remove', '移除');
			remove.setAttribute('role', 'button');

			this.placesDisposables.add(addDisposableListener(row, EventType.CLICK, () => {
				void this.openPlace(location, favorite);
			}));
			this.placesDisposables.add(addDisposableListener(row, EventType.KEY_DOWN, event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					void this.openPlace(location, favorite);
				}
			}));
			this.placesDisposables.add(addDisposableListener(remove, EventType.CLICK, event => {
				event.stopPropagation();
				if (favorite) {
					this.directoryService.removeFavorite(location);
				} else {
					this.directoryService.removeRecent(location);
				}
			}));
		}
	}

	private async openPlace(location: string, favorite: boolean): Promise<void> {
		try {
			const stat = await this.explorerService.stat(location);
			if (!stat.isDir) {
				throw new Error('not a directory');
			}
			this.directoryService.navigate(location);
		} catch {
			const remove = () => favorite
				? this.directoryService.removeFavorite(location)
				: this.directoryService.removeRecent(location);
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('sidex.places.missing', '目录不存在或无法访问：{0}', location),
				actions: {
					primary: [
						toAction({
							id: 'sidex.places.removeMissing',
							label: localize('sidex.places.remove', '移除'),
							run: remove
						})
					]
				}
			});
		}
	}

	override dispose(): void {
		for (const state of this.states.values()) {
			state.renderDisposables.dispose();
			state.scrollable.dispose();
		}
		this.states.clear();
		super.dispose();
	}

	private get activeState(): NavigationTabState | undefined {
		return this.activeTabId ? this.states.get(this.activeTabId) : undefined;
	}

	/** 让左侧导航树跟随目录标签：清理已关闭标签、切换显示、必要时展开当前路径。 */
	private syncTabs(): void {
		const tabIds = new Set(this.directoryService.tabs.map(tab => tab.id));
		for (const [tabId, state] of [...this.states]) {
			if (!tabIds.has(tabId)) {
				this.states.delete(tabId);
				state.renderDisposables.dispose();
				state.scrollable.dispose();
				state.scrollableNode.remove();
			}
		}

		const tab = this.directoryService.activeTab;
		if (!tab) {
			this.activeTabId = undefined;
			for (const state of this.states.values()) {
				state.scrollableNode.style.display = 'none';
			}
			return;
		}

		const switched = this.activeTabId !== tab.id;
		this.activeTabId = tab.id;

		const state = this.ensureState(tab.id);
		for (const [tabId, other] of this.states) {
			other.scrollableNode.style.display = tabId === tab.id ? '' : 'none';
		}
		if (switched) {
			state.scrollable.scanDomNode();
		}

		if (state.revealedLocation !== tab.location) {
			void this.revealLocation(state, tab.location);
			return;
		}

		if (state.needsRender || state.renderedRefreshToken !== tab.refreshToken) {
			this.renderTree(state);
		}
	}

	private ensureState(tabId: string): NavigationTabState {
		const existing = this.states.get(tabId);
		if (existing) {
			return existing;
		}

		const tree = $('.sidex-navigation-tree');
		const scrollable = new DomScrollableElement(tree, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Visible,
			verticalScrollbarSize: 10,
			useShadows: false
		});
		const scrollableNode = scrollable.getDomNode();
		scrollableNode.classList.add('sidex-navigation-scrollable');
		scrollableNode.style.display = 'none';
		this.viewsRoot?.appendChild(scrollableNode);

		const state: NavigationTabState = {
			tabId,
			tree,
			scrollable,
			scrollableNode,
			renderDisposables: new DisposableStore(),
			expandedPaths: new Set<string>(['']),
			childrenByPath: new Map<string, INavigationNode[]>(),
			loadingPaths: new Set<string>(),
			revealToken: 0,
			revealedLocation: undefined,
			renderedRefreshToken: -1,
			needsRender: true
		};
		this.states.set(tabId, state);
		this.renderTree(state);
		return state;
	}

	private async revealLocation(state: NavigationTabState, location: string): Promise<void> {
		const token = ++state.revealToken;
		state.revealedLocation = location;

		for (const path of this.ancestorsFor(location)) {
			if (token !== state.revealToken) {
				return;
			}
			state.expandedPaths.add(path);
			if (path && !state.childrenByPath.has(path)) {
				await this.loadChildren(state, path);
			}
		}

		if (token === state.revealToken) {
			this.renderTree(state);
		}
	}

	/** 返回从根到当前目录的整条路径（含当前目录本身）。 */
	private ancestorsFor(location: string): string[] {
		if (!location) {
			return [''];
		}

		const parts = normalizeLocation(location).split('\\').filter(part => part.length > 0);
		if (!parts.length) {
			return [''];
		}

		const chain: string[] = ['', `${parts[0]}\\`];
		let current = chain[1];
		for (let index = 1; index < parts.length; index++) {
			current = current.endsWith('\\') ? `${current}${parts[index]}` : `${current}\\${parts[index]}`;
			chain.push(current);
		}
		return chain;
	}

	private async loadChildren(state: NavigationTabState, path: string): Promise<void> {
		if (!path || state.childrenByPath.has(path) || state.loadingPaths.has(path)) {
			return;
		}

		state.loadingPaths.add(path);
		try {
			const entries = await this.explorerService.readDirectory(path);
			const folders = entries
				.filter(entry => entry.isDir)
				.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
				.map<INavigationNode>(entry => ({
					path: entry.path,
					name: entry.name,
					kind: 'folder',
					depth: 0
				}));
			state.childrenByPath.set(path, folders);
		} catch {
			state.childrenByPath.set(path, []);
		} finally {
			state.loadingPaths.delete(path);
			// 标签可能已经关闭，避免渲染已释放的树。
			if (this.states.get(state.tabId) === state) {
				this.renderTree(state);
			}
		}
	}

	private renderTree(state: NavigationTabState): void {
		const tab = this.directoryService.getTab(state.tabId);
		if (!tab) {
			return;
		}

		state.renderDisposables.clear();
		state.needsRender = false;
		state.renderedRefreshToken = tab.refreshToken;
		reset(state.tree);

		const activeLocation = tab.location;
		this.renderRow(state, { path: '', name: localize('sidex.thisPc', '此电脑'), kind: 'this-pc', depth: 0 }, activeLocation);

		if (state.expandedPaths.has('')) {
			this.renderChildren(state, '', 1, activeLocation);
		}

		// 已经展开但还没有缓存的节点，逐个补读子目录。
		for (const path of state.expandedPaths) {
			if (path && !state.childrenByPath.has(path) && !state.loadingPaths.has(path)) {
				void this.loadChildren(state, path);
			}
		}

		// 内容高度变化后重新测量，滚动条才能正确出现/更新。
		if (this.activeTabId === state.tabId) {
			state.scrollable.scanDomNode();
		}
	}

	private renderChildren(state: NavigationTabState, path: string, depth: number, activeLocation: string): void {
		const children = this.getChildren(state, path);
		for (const child of children) {
			const node: INavigationNode = { ...child, depth };
			this.renderRow(state, node, activeLocation);
			if (state.expandedPaths.has(node.path) && state.childrenByPath.has(node.path)) {
				this.renderChildren(state, node.path, depth + 1, activeLocation);
			}
		}
	}

	private getChildren(state: NavigationTabState, path: string): INavigationNode[] {
		if (!path) {
			return this.directoryService.drives.map(drive => {
				const label = drive.label || this.defaultDriveLabel(drive.kind);
				return {
					path: drive.path,
					name: label ? `${label} (${drive.letter})` : drive.letter,
					kind: 'drive' as const,
					depth: 0
				};
			});
		}
		return state.childrenByPath.get(path) ?? [];
	}

	private renderRow(state: NavigationTabState, node: INavigationNode, activeLocation: string): void {
		const row = $('div.sidex-navigation-row');
		row.style.paddingLeft = `${8 + node.depth * 16}px`;
		row.setAttribute('role', 'treeitem');
		row.tabIndex = 0;

		const normalizedActive = normalizeLocation(activeLocation).toLowerCase();
		const normalizedNode = node.path ? normalizeLocation(node.path).toLowerCase() : '';
		const active = node.kind === 'this-pc' ? activeLocation === '' : normalizedNode === normalizedActive;
		if (active) {
			row.classList.add('active');
		}

		const expanded = node.kind === 'this-pc' ? true : state.expandedPaths.has(node.path);

		const chevron = append(row, $('span.sidex-navigation-chevron'));
		const chevronIcon = append(chevron, $('span.codicon'));
		chevronIcon.classList.add(expanded ? 'codicon-chevron-down' : 'codicon-chevron-right');
		chevron.setAttribute('role', 'button');
		chevron.title = expanded
			? localize('sidex.navigation.collapse', '折叠')
			: localize('sidex.navigation.expand', '展开');

		const iconElement = append(row, $('span.sidex-navigation-icon'));
		iconElement.innerHTML = this.iconFor(node);

		const label = append(row, $('span.sidex-navigation-label'));
		label.textContent = node.name;

		state.renderDisposables.add(addDisposableListener(chevron, EventType.CLICK, event => {
			event.stopPropagation();
			this.toggleNode(state, node);
		}));

		state.renderDisposables.add(addDisposableListener(row, EventType.CLICK, () => {
			this.directoryService.navigate(node.path);
			if (node.kind !== 'this-pc' && !state.expandedPaths.has(node.path)) {
				state.expandedPaths.add(node.path);
				if (!state.childrenByPath.has(node.path)) {
					void this.loadChildren(state, node.path);
				}
				this.renderTree(state);
			}
		}));

		state.renderDisposables.add(addDisposableListener(row, EventType.KEY_DOWN, event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				this.directoryService.navigate(node.path);
			}
		}));

		state.tree.appendChild(row);
	}

	private toggleNode(state: NavigationTabState, node: INavigationNode): void {
		if (node.kind === 'this-pc') {
			state.expandedPaths.add('');
			this.renderTree(state);
			return;
		}

		if (state.expandedPaths.has(node.path)) {
			state.expandedPaths.delete(node.path);
		} else {
			state.expandedPaths.add(node.path);
			if (!state.childrenByPath.has(node.path)) {
				void this.loadChildren(state, node.path);
			}
		}
		this.renderTree(state);
	}

	private iconFor(node: INavigationNode): string {
		switch (node.kind) {
			case 'this-pc':
				return pcIconSvg();
			case 'drive': {
				const drive = this.directoryService.drives.find(item => normalizeLocation(item.path).toLowerCase() === normalizeLocation(node.path).toLowerCase());
				return driveIconSvg(drive?.kind ?? 'fixed');
			}
			default:
				return folderIconSvg();
		}
	}

	private onDrivesChange(): void {
		for (const state of this.states.values()) {
			state.needsRender = true;
		}
		const state = this.activeState;
		if (state) {
			this.renderTree(state);
		}
	}

	private defaultDriveLabel(kind: string): string {
		switch (kind) {
			case 'fixed':
				return localize('sidex.drive.localDisk', '本地磁盘');
			case 'removable':
				return localize('sidex.drive.removableDisk', '可移动磁盘');
			case 'network':
				return localize('sidex.drive.networkDrive', '网络驱动器');
			case 'cdrom':
				return localize('sidex.drive.cdDrive', 'DVD 驱动器');
			default:
				return '';
		}
	}
}
