/*---------------------------------------------------------------------------------------------
 *  SideX — 标题栏第二行：前进/后退/向上/刷新 + 地址栏 + 搜索框
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, reset } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDirectoryService, normalizeLocation } from './directoryService.js';
import { IFileListViewService } from './fileListViewService.js';

interface IBreadcrumbSegment {
	readonly label: string;
	readonly location: string;
}

type DropdownItem =
	| {
		readonly kind?: 'item';
		readonly label: string;
		readonly checked?: boolean;
		readonly run: () => void;
	}
	| 'separator'
	| {
		readonly kind: 'direction';
		readonly ascending: boolean;
		readonly onPick: (ascending: boolean) => void;
	};

/** 查看按钮：2×2 网格。 */
const VIEW_ICON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>';

/** 排序按钮：递减横线 + 向下箭头。 */
const SORT_ICON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h7M2 8h5M2 12h3"/><path d="M12 4v8M9.5 9.5 12 12l2.5-2.5"/></svg>';

const SEARCH_DEBOUNCE_MS = 300;

export class DirectoryNavBarControl extends Disposable {

	private readonly backButton: HTMLButtonElement;
	private readonly forwardButton: HTMLButtonElement;
	private readonly upButton: HTMLButtonElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly viewButton: HTMLButtonElement;
	private readonly sortButton: HTMLButtonElement;
	private readonly directionButton: HTMLButtonElement;
	private readonly breadcrumb: HTMLElement;
	private readonly searchInput: HTMLInputElement;
	private readonly renderDisposables = this._register(new DisposableStore());
	private searchTimer: number | undefined;
	private dropdown: HTMLElement | undefined;
	private dropdownAnchor: HTMLElement | undefined;

	constructor(
		private readonly container: HTMLElement,
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@IFileListViewService private readonly fileListViewService: IFileListViewService
	) {
		super();

		this.container.classList.add('sidex-explorer-navbar');

		const navigation = append(this.container, $('div.sidex-explorer-nav-actions'));

		this.backButton = this.createNavButton(navigation, 'codicon-arrow-left', localize('sidex.nav.back', '后退'));
		this.forwardButton = this.createNavButton(navigation, 'codicon-arrow-right', localize('sidex.nav.forward', '前进'));
		this.upButton = this.createNavButton(navigation, 'codicon-arrow-up', localize('sidex.nav.up', '向上一级'));
		this.refreshButton = this.createNavButton(navigation, 'codicon-refresh', localize('sidex.nav.refresh', '刷新'));
		this.viewButton = this.createDropdownButton(navigation, VIEW_ICON_SVG, localize('sidex.nav.view', '查看'));
		this.sortButton = this.createDropdownButton(navigation, SORT_ICON_SVG, localize('sidex.nav.sort', '排序方式'));
		this.directionButton = this.createNavButton(navigation, 'codicon-arrow-up', localize('sidex.nav.sortAscending', '当前升序，点击切换为降序'));

		this._register(addDisposableListener(this.backButton, EventType.CLICK, () => this.directoryService.goBack()));
		this._register(addDisposableListener(this.forwardButton, EventType.CLICK, () => this.directoryService.goForward()));
		this._register(addDisposableListener(this.upButton, EventType.CLICK, () => this.directoryService.goUp()));
		this._register(addDisposableListener(this.refreshButton, EventType.CLICK, () => this.directoryService.refresh()));
		this._register(addDisposableListener(this.viewButton, EventType.CLICK, () => this.showViewMenu()));
		this._register(addDisposableListener(this.sortButton, EventType.CLICK, () => this.showSortMenu()));
		this._register(addDisposableListener(this.directionButton, EventType.CLICK, () => {
			const state = this.fileListViewService.getViewState();
			this.fileListViewService.setSortAscending(!state.sortAscending);
		}));
		this._register(this.fileListViewService.onDidChange(() => this.update()));
		this._register(toDisposable(() => this.hideDropdown()));

		const addressBar = append(this.container, $('div.sidex-explorer-address-bar'));
		this.breadcrumb = append(addressBar, $('div.sidex-explorer-breadcrumb'));
		this.breadcrumb.setAttribute('role', 'navigation');

		this.searchInput = $('input.sidex-explorer-search') as HTMLInputElement;
		this.searchInput.type = 'text';
		this.searchInput.spellcheck = false;
		append(this.container, this.searchInput);

		this._register(addDisposableListener(this.searchInput, EventType.KEY_DOWN, event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.commitSearch(this.searchInput.value.trim());
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.searchInput.value = '';
				this.commitSearch('');
			}
		}));
		// 输入即搜：300ms 防抖后触发递归名称搜索。
		this._register(addDisposableListener(this.searchInput, EventType.INPUT, () => {
			this.scheduleSearch(this.searchInput.value.trim());
		}));
		this._register(toDisposable(() => {
			if (this.searchTimer !== undefined) {
				window.clearTimeout(this.searchTimer);
				this.searchTimer = undefined;
			}
		}));

		this._register(addDisposableListener(this.breadcrumb, EventType.DBLCLICK, () => this.beginAddressEdit()));

		this._register(this.directoryService.onDidChange(() => this.update()));
		this.update();
	}

	private scheduleSearch(value: string): void {
		if (this.searchTimer !== undefined) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = undefined;
		}
		if (!value) {
			this.directoryService.setSearch('');
			return;
		}
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = undefined;
			this.directoryService.setSearch(value);
		}, SEARCH_DEBOUNCE_MS);
	}

	private commitSearch(value: string): void {
		if (this.searchTimer !== undefined) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = undefined;
		}
		this.directoryService.setSearch(value);
	}

	private beginAddressEdit(): void {
		const input = $('input.sidex-explorer-address-input') as HTMLInputElement;
		input.type = 'text';
		input.spellcheck = false;
		input.value = this.directoryService.activeLocation;
		input.style.cssText = [
			'flex:1 1 auto;min-width:0;height:22px;padding:0 6px;font-size:12px',
			'background:var(--vscode-input-background);color:var(--vscode-input-foreground)',
			'border:1px solid var(--vscode-focusBorder);border-radius:2px;outline:none'
		].join(';');

		this.breadcrumb.style.display = 'none';
		this.breadcrumb.parentElement?.appendChild(input);
		input.focus();
		input.select();

		let closed = false;
		const close = (apply: boolean) => {
			if (closed) {
				return;
			}
			closed = true;
			const value = input.value;
			input.remove();
			this.breadcrumb.style.display = '';
			if (apply) {
				this.directoryService.navigate(normalizeLocation(value));
			}
		};

		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				close(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				close(false);
			}
		});
		input.addEventListener('blur', () => close(false));
	}

	private showViewMenu(): void {
		const state = this.fileListViewService.getViewState();
		this.showDropdown(this.viewButton, [
			{
				label: localize('sidex.view.details', '详细信息'),
				checked: state.viewMode === 'details',
				run: () => this.fileListViewService.setViewMode('details')
			},
			{
				label: localize('sidex.view.list', '列表'),
				checked: state.viewMode === 'list',
				run: () => this.fileListViewService.setViewMode('list')
			},
			{
				label: localize('sidex.view.icons', '图标'),
				checked: state.viewMode === 'icons',
				run: () => this.fileListViewService.setViewMode('icons')
			}
		]);
	}

	private showSortMenu(): void {
		const state = this.fileListViewService.getViewState();
		this.showDropdown(this.sortButton, [
			{
				label: localize('sidex.fileList.name', '名称'),
				checked: state.sortKey === 'name',
				run: () => this.fileListViewService.setSortKey('name')
			},
			{
				label: localize('sidex.fileList.modified', '修改日期'),
				checked: state.sortKey === 'modified',
				run: () => this.fileListViewService.setSortKey('modified')
			},
			{
				label: localize('sidex.fileList.type', '类型'),
				checked: state.sortKey === 'type',
				run: () => this.fileListViewService.setSortKey('type')
			},
			{
				label: localize('sidex.fileList.size', '大小'),
				checked: state.sortKey === 'size',
				run: () => this.fileListViewService.setSortKey('size')
			},
			'separator',
			{
				kind: 'direction',
				ascending: state.sortAscending,
				onPick: ascending => this.fileListViewService.setSortAscending(ascending)
			},
			'separator',
			{
				label: localize('sidex.menu.showExtensions', '显示文件扩展名'),
				checked: this.fileListViewService.showExtensions,
				run: () => this.fileListViewService.toggleShowExtensions()
			}
		]);
	}

	private showDropdown(anchor: HTMLElement, items: readonly DropdownItem[]): void {
		if (this.dropdown && this.dropdownAnchor === anchor) {
			this.hideDropdown();
			return;
		}
		this.hideDropdown();

		const menu = $('div.sidex-context-menu');
		menu.style.minWidth = '170px';
		menu.style.visibility = 'hidden';
		const rect = anchor.getBoundingClientRect();
		menu.style.left = `${rect.left}px`;
		menu.style.top = `${rect.bottom + 4}px`;
		const host = document.querySelector('.monaco-workbench') ?? document.body;
		host.appendChild(menu);
		this.dropdown = menu;
		this.dropdownAnchor = anchor;

		for (const item of items) {
			if (item === 'separator') {
				append(menu, $('div.sidex-explorer-menu-separator'));
				continue;
			}
			if (item.kind === 'direction') {
				const row = append(menu, $('div.sidex-menu-direction'));
				const ascendingButton = this.createDirectionButton(row, 'codicon-arrow-up', localize('sidex.menu.sortAscending', '升序'), item.ascending);
				const descendingButton = this.createDirectionButton(row, 'codicon-arrow-down', localize('sidex.menu.sortDescending', '降序'), !item.ascending);
				ascendingButton.addEventListener('mousedown', event => {
					event.preventDefault();
					event.stopPropagation();
					this.hideDropdown();
					item.onPick(true);
				});
				descendingButton.addEventListener('mousedown', event => {
					event.preventDefault();
					event.stopPropagation();
					this.hideDropdown();
					item.onPick(false);
				});
				continue;
			}
			const row = append(menu, $('div.sidex-context-menu-item'));
			row.appendChild(this.createCheckIcon(!!item.checked));
			const label = append(row, $('span.sidex-menu-item-label'));
			label.textContent = item.label;
			row.addEventListener('mousedown', event => {
				event.preventDefault();
				event.stopPropagation();
				this.hideDropdown();
				item.run();
			});
		}

		const menuRect = menu.getBoundingClientRect();
		if (menuRect.right > window.innerWidth) {
			menu.style.left = `${Math.max(4, window.innerWidth - menuRect.width - 4)}px`;
		}
		if (menuRect.bottom > window.innerHeight) {
			menu.style.top = `${Math.max(4, rect.top - menuRect.height - 4)}px`;
		}
		menu.style.visibility = '';

		window.setTimeout(() => {
			const dismiss = (dismissEvent: MouseEvent) => {
				const target = dismissEvent.target as Node;
				if (!menu.contains(target) && !anchor.contains(target)) {
					this.hideDropdown();
				}
			};
			window.addEventListener('mousedown', dismiss, { once: true });
			window.addEventListener('blur', () => this.hideDropdown(), { once: true });
		}, 0);
	}

	private hideDropdown(): void {
		this.dropdown?.remove();
		this.dropdown = undefined;
		this.dropdownAnchor = undefined;
	}

	private createCheckIcon(checked: boolean): HTMLElement {
		const icon = $('span.sidex-menu-item-icon');
		if (!checked) {
			icon.classList.add('hidden');
		}
		append(icon, $('span.codicon.codicon-check'));
		return icon;
	}

	private createDirectionButton(parent: HTMLElement, icon: string, label: string, active: boolean): HTMLButtonElement {
		const button = append(parent, $('button.sidex-menu-direction-button')) as HTMLButtonElement;
		button.type = 'button';
		if (active) {
			button.classList.add('active');
		}
		const iconElement = append(button, $('span.codicon'));
		iconElement.classList.add(icon);
		const text = append(button, $('span'));
		text.textContent = label;
		return button;
	}

	private createDropdownButton(parent: HTMLElement, iconSvg: string, title: string): HTMLButtonElement {
		const button = $('button.sidex-explorer-nav-button.has-caret') as HTMLButtonElement;
		button.type = 'button';
		button.title = title;
		button.innerHTML = iconSvg;
		const caret = append(button, $('span.codicon.codicon-chevron-down.sidex-explorer-nav-caret'));
		caret.setAttribute('aria-hidden', 'true');
		parent.appendChild(button);
		return button;
	}

	private setNavButtonIcon(button: HTMLButtonElement, icon: string): void {
		const iconElement = button.firstElementChild;
		if (iconElement instanceof HTMLElement) {
			iconElement.className = `codicon ${icon}`;
		}
	}

	private createNavButton(parent: HTMLElement, icon: string, title: string): HTMLButtonElement {
		const button = $('button.sidex-explorer-nav-button') as HTMLButtonElement;
		button.type = 'button';
		button.title = title;
		const iconElement = append(button, $('span.codicon'));
		iconElement.classList.add(icon);
		parent.appendChild(button);
		return button;
	}

	private update(): void {
		this.renderDisposables.clear();
		const tab = this.directoryService.activeTab;

		this.backButton.disabled = !this.directoryService.canGoBack();
		this.forwardButton.disabled = !this.directoryService.canGoForward();
		this.upButton.disabled = !this.directoryService.canGoUp();
		this.refreshButton.disabled = !tab;
		this.viewButton.disabled = !tab;
		this.sortButton.disabled = !tab;
		this.directionButton.disabled = !tab;
		const ascending = this.fileListViewService.getViewState().sortAscending;
		this.directionButton.title = ascending
			? localize('sidex.nav.sortAscending', '当前升序，点击切换为降序')
			: localize('sidex.nav.sortDescending', '当前降序，点击切换为升序');
		this.setNavButtonIcon(this.directionButton, ascending ? 'codicon-arrow-up' : 'codicon-arrow-down');

		const segments = this.getSegments();
		reset(this.breadcrumb);

		segments.forEach((segment, index) => {
			if (index > 0) {
				const separator = $('span.sidex-explorer-breadcrumb-sep');
				separator.textContent = '›';
				this.breadcrumb.appendChild(separator);
			}

			const element = $('span.sidex-explorer-breadcrumb-segment');
			element.textContent = segment.label;
			if (index === segments.length - 1) {
				element.classList.add('current');
			} else {
				this.renderDisposables.add(addDisposableListener(element, EventType.CLICK, () => this.directoryService.navigate(segment.location)));
			}
			this.breadcrumb.appendChild(element);
		});

		const title = tab?.title ?? '';
		// 导航/切换标签会清空搜索词，同步清空输入框以免误导。
		if (!this.directoryService.searchQuery && this.searchInput.value) {
			this.searchInput.value = '';
		}
		this.searchInput.placeholder = title
			? localize('sidex.search.inLocation', '在 {0} 中搜索', title)
			: localize('sidex.search.here', '在此电脑中搜索');
	}

	private getSegments(): IBreadcrumbSegment[] {
		const location = this.directoryService.activeLocation;
		const root: IBreadcrumbSegment = {
			label: localize('sidex.thisPc', '此电脑'),
			location: ''
		};
		if (!location) {
			return [root];
		}

		const parts = normalizeLocation(location).split('\\').filter(part => part.length > 0);
		const segments: IBreadcrumbSegment[] = [root];
		let current = '';
		for (const part of parts) {
			current = current ? `${current}\\${part}` : `${part}\\`;
			segments.push({ label: part, location: current });
		}
		return segments;
	}
}
