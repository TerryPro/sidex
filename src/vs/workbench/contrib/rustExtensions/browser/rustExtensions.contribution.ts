/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/rustExtensions.css';

import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import {
	Extensions as ViewExtensions,
	IViewContainersRegistry,
	IViewDescriptor,
	IViewsRegistry,
	IViewDescriptorService
} from '../../../common/views.js';
import { DefaultViewsContext, VIEWLET_ID } from '../../extensions/common/extensions.js';
import {
	IBuiltinExtensionsScannerService,
	IExtension
} from '../../../../platform/extensions/common/extensions.js';
import { IRustExtensionInfo, listRustExtensions, onDidChangeRustExtensions } from './rustExtensionsService.js';

const VIEW_ID = 'workbench.view.rustExtensions.view';
const BUILTIN_VIEW_ID = 'workbench.view.rustExtensions.builtinView';

let activeRustView: RustExtensionsView | undefined;
let activeBuiltinView: BuiltinExtensionsView | undefined;

interface IExtensionBadge {
	readonly label: string;
	readonly kind?: 'loaded' | 'idle' | 'muted' | 'category';
}

interface IExtensionListItem {
	readonly id: string;
	readonly name: string;
	readonly publisher?: string;
	readonly version?: string;
	readonly description?: string;
	readonly detail?: string;
	readonly icon: ThemeIcon;
	readonly accent?: 'rust' | 'languages' | 'themes' | 'snippets' | 'other';
	readonly badges: IExtensionBadge[];
	readonly tooltip?: string;
	readonly searchText: string;
}

function formatSize(bytes: number): string {
	if (!bytes) {
		return '—';
	}
	return bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.round(bytes / 1024)} KB`;
}

function categoryRank(category: string | undefined): number {
	switch (category) {
		case 'Programming Languages':
			return 0;
		case 'Snippets':
			return 1;
		case 'Themes':
			return 2;
		default:
			return 3;
	}
}

function categoryLabel(category: string | undefined): string {
	switch (category) {
		case 'Programming Languages':
			return localize('sidexExtensions.category.languages', '编程语言');
		case 'Snippets':
			return localize('sidexExtensions.category.snippets', '代码片段');
		case 'Themes':
			return localize('sidexExtensions.category.themes', '主题');
		default:
			return localize('sidexExtensions.category.other', '其他');
	}
}

function categoryIcon(category: string | undefined): ThemeIcon {
	switch (category) {
		case 'Programming Languages':
			return Codicon.code;
		case 'Snippets':
			return Codicon.symbolSnippet;
		case 'Themes':
			return Codicon.paintcan;
		default:
			return Codicon.extensions;
	}
}

function categoryAccent(
	category: string | undefined
): 'rust' | 'languages' | 'themes' | 'snippets' | 'other' {
	switch (category) {
		case 'Programming Languages':
			return 'languages';
		case 'Snippets':
			return 'snippets';
		case 'Themes':
			return 'themes';
		default:
			return 'other';
	}
}

abstract class SidexExtensionListView extends ViewPane {
	private items: IExtensionListItem[] = [];
	private filter = '';
	private errorText: string | undefined;

	private searchInput!: HTMLInputElement;
	private summary!: HTMLElement;
	private list!: HTMLElement;
	private scrollableElement: DomScrollableElement | undefined;
	private empty!: HTMLElement;
	private emptyIcon!: HTMLElement;
	private emptyText!: HTMLElement;

	protected readonly bodyDisposables = this._register(new DisposableStore());

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
		@IHoverService hoverService: IHoverService
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

		this.bodyDisposables.add(
			this.onDidChangeBodyVisibility(visible => {
				if (visible) {
					void this.refresh();
				}
			})
		);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const root = append(container, $('.sidex-ext-view'));

		const toolbar = append(root, $('.sidex-ext-toolbar'));
		const search = append(toolbar, $('.sidex-ext-search'));
		append(search, $('span.codicon.codicon-search'));
		this.searchInput = append(search, $('input')) as HTMLInputElement;
		this.searchInput.type = 'text';
		this.searchInput.placeholder = localize('sidexExtensions.search', '搜索扩展');
		this.searchInput.setAttribute('aria-label', localize('sidexExtensions.searchAriaLabel', '搜索扩展'));
		this.searchInput.spellcheck = false;
		this.summary = append(toolbar, $('.sidex-ext-summary'));

		this.list = $('.sidex-ext-list');
		this.list.setAttribute('role', 'list');
		this.scrollableElement = new DomScrollableElement(this.list, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			verticalScrollbarSize: 10,
			useShadows: false
		});
		this.bodyDisposables.add(this.scrollableElement);
		const scrollableNode = this.scrollableElement.getDomNode();
		scrollableNode.classList.add('sidex-ext-scrollable');
		append(root, scrollableNode);

		this.empty = append(root, $('.sidex-ext-empty'));
		this.emptyIcon = append(this.empty, $('span.codicon'));
		this.emptyText = append(this.empty, $('span.sidex-ext-empty-text'));

		this.bodyDisposables.add(
			addDisposableListener(this.searchInput, EventType.INPUT, () => {
				this.filter = this.searchInput.value.trim().toLowerCase();
				this.renderItems();
			})
		);

		void this.refresh();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.scrollableElement?.scanDomNode();
	}

	async refresh(): Promise<void> {
		try {
			this.items = await this.loadItems();
			this.errorText = undefined;
		} catch {
			this.items = [];
			this.errorText = this.getErrorText();
		}

		this.renderItems();
	}

	protected abstract loadItems(): Promise<IExtensionListItem[]>;
	protected abstract getSummary(items: readonly IExtensionListItem[]): string;
	protected abstract getEmptyText(): string;

	protected getErrorText(): string {
		return localize('sidexExtensions.loadFailed', '加载扩展失败');
	}

	private get filteredItems(): IExtensionListItem[] {
		if (!this.filter) {
			return this.items;
		}
		return this.items.filter(item => item.searchText.includes(this.filter));
	}

	private renderItems(): void {
		const visible = this.filteredItems;

		this.list.replaceChildren();
		for (const item of visible) {
			this.list.appendChild(this.renderRow(item));
		}

		const scrollableNode = this.scrollableElement?.getDomNode();
		if (scrollableNode) {
			scrollableNode.style.display = visible.length ? '' : 'none';
		}
		this.empty.style.display = visible.length ? 'none' : 'flex';
		this.emptyIcon.className = `codicon ${
			this.errorText ? 'codicon-error' : this.filter ? 'codicon-search' : 'codicon-library'
		}`;
		this.emptyText.textContent = this.errorText ?? (this.filter ? localize('sidexExtensions.noResults', '没有匹配的扩展') : this.getEmptyText());

		if (this.errorText) {
			this.summary.textContent = '';
		} else if (this.filter) {
			this.summary.textContent = localize(
				'sidexExtensions.filteredSummary',
				'{0} · 显示 {1} / {2}',
				this.getSummary(this.items),
				visible.length,
				this.items.length
			);
		} else {
			this.summary.textContent = this.getSummary(this.items);
		}

		this.scrollableElement?.scanDomNode();
	}

	private renderRow(item: IExtensionListItem): HTMLElement {
		const row = $('.sidex-ext-row');
		row.tabIndex = 0;
		row.setAttribute('role', 'listitem');
		if (item.tooltip) {
			row.title = item.tooltip;
		}

		const iconBox = append(row, $('.sidex-ext-icon'));
		iconBox.classList.add(`accent-${item.accent ?? 'other'}`);
		if (item.badges.some(badge => badge.kind === 'loaded')) {
			iconBox.classList.add('loaded');
		}
		const icon = append(iconBox, $('span.codicon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(item.icon));

		const info = append(row, $('.sidex-ext-info'));

		const header = append(info, $('.sidex-ext-header'));
		append(header, $('span.sidex-ext-name')).textContent = item.name;
		if (item.version) {
			append(header, $('span.sidex-ext-version')).textContent = `v${item.version}`;
		}

		if (item.description) {
			append(info, $('.sidex-ext-desc')).textContent = item.description;
		}

		const metaParts: string[] = [];
		if (item.publisher) {
			metaParts.push(item.publisher);
		}
		if (item.detail) {
			metaParts.push(item.detail);
		}

		if (metaParts.length || item.badges.length) {
			const footer = append(info, $('.sidex-ext-footer'));
			if (metaParts.length) {
				append(footer, $('.sidex-ext-meta')).textContent = metaParts.join(' · ');
			}
			if (item.badges.length) {
				const badges = append(footer, $('.sidex-ext-badges'));
				for (const badge of item.badges) {
					const badgeElement = append(badges, $('span.sidex-ext-badge'));
					badgeElement.textContent = badge.label;
					if (badge.kind) {
						badgeElement.classList.add(badge.kind);
					}
				}
			}
		}

		return row;
	}

	override dispose(): void {
		this.bodyDisposables.dispose();
		super.dispose();
	}
}

class RustExtensionsView extends SidexExtensionListView {
	static readonly ID = VIEW_ID;

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
		@IHoverService hoverService: IHoverService
	) {
		super(
			options,
			instantiationService,
			viewDescriptorService,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			openerService,
			themeService,
			hoverService
		);

		activeRustView = this;
		this._register({
			dispose: () => {
				if (activeRustView === this) {
					activeRustView = undefined;
				}
			}
		});
		this.bodyDisposables.add(onDidChangeRustExtensions.event(() => void this.refresh()));
	}

	protected async loadItems(): Promise<IExtensionListItem[]> {
		let extensions: IRustExtensionInfo[];
		try {
			extensions = await listRustExtensions();
		} catch {
			throw new Error('Rust extension info unavailable');
		}

		extensions.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.name.localeCompare(b.name));

		return extensions.map(extension => ({
			id: extension.id,
			name: extension.name,
			version: extension.version,
			description: extension.activationEvents.length
				? extension.activationEvents.join(' · ')
				: localize('sidexExtensions.resident', '常驻'),
			detail: formatSize(extension.sizeBytes),
			icon: Codicon.chip,
			accent: 'rust',
			badges: [
				{
					label: extension.loaded
						? localize('sidexExtensions.loaded', '已加载')
						: localize('sidexExtensions.idle', '未加载'),
					kind: extension.loaded ? 'loaded' : 'idle'
				}
			],
			tooltip: `${extension.path}\n${extension.wasmBinary}`,
			searchText: `${extension.name} ${extension.id} ${extension.activationEvents.join(
				' '
			)}`.toLowerCase()
		}));
	}

	protected getSummary(items: readonly IExtensionListItem[]): string {
		const loaded = items.filter(item => item.badges.some(badge => badge.kind === 'loaded')).length;
		return localize('sidexExtensions.rustSummary', '共 {0} 个 · 已加载 {1} 个', items.length, loaded);
	}

	protected getEmptyText(): string {
		return localize('sidexExtensions.rustEmpty', '没有发现 Rust 扩展');
	}

	protected override getErrorText(): string {
		return localize('sidexExtensions.rustError', 'Rust 扩展信息仅在桌面端可用');
	}
}

class BuiltinExtensionsView extends SidexExtensionListView {
	static readonly ID = BUILTIN_VIEW_ID;

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
		@IBuiltinExtensionsScannerService
		private readonly builtinExtensionsScannerService: IBuiltinExtensionsScannerService
	) {
		super(
			options,
			instantiationService,
			viewDescriptorService,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			openerService,
			themeService,
			hoverService
		);

		activeBuiltinView = this;
		this._register({
			dispose: () => {
				if (activeBuiltinView === this) {
					activeBuiltinView = undefined;
				}
			}
		});
	}

	protected async loadItems(): Promise<IExtensionListItem[]> {
		const extensions = await this.builtinExtensionsScannerService.scanBuiltinExtensions();
		const sorted = [...extensions].sort((a, b) => {
			const rank =
				categoryRank(a.manifest.categories?.[0]) - categoryRank(b.manifest.categories?.[0]);
			return rank || this.displayName(a).localeCompare(this.displayName(b));
		});

		return sorted.map(extension => this.toItem(extension));
	}

	private displayName(extension: IExtension): string {
		return extension.manifest.displayName || extension.manifest.name;
	}

	private toItem(extension: IExtension): IExtensionListItem {
		const manifest = extension.manifest;
		const category = manifest.categories?.[0];
		const languageCount = manifest.contributes?.languages?.length ?? 0;
		const themeCount =
			(manifest.contributes?.themes?.length ?? 0) + (manifest.contributes?.iconThemes?.length ?? 0);

		const details: string[] = [];
		if (languageCount) {
			details.push(localize('sidexExtensions.languageCount', '{0} 种语言', languageCount));
		}
		if (themeCount) {
			details.push(localize('sidexExtensions.themeCount', '{0} 个主题', themeCount));
		}

		return {
			id: extension.identifier.id,
			name: this.displayName(extension),
			publisher: manifest.publisher,
			version: manifest.version,
			description: manifest.description,
			detail: details.length ? details.join(' · ') : undefined,
			icon: categoryIcon(category),
			accent: categoryAccent(category),
			badges: [
				{ label: categoryLabel(category), kind: 'category' },
				{ label: localize('sidexExtensions.builtin', '内置'), kind: 'muted' }
			],
			tooltip: `${extension.identifier.id}\n${extension.location.toString()}`,
			searchText: `${this.displayName(extension)} ${manifest.name} ${manifest.publisher} ${
				manifest.description ?? ''
			} ${(manifest.categories ?? []).join(' ')}`.toLowerCase()
		};
	}

	protected getSummary(items: readonly IExtensionListItem[]): string {
		return localize('sidexExtensions.builtinSummary', '共 {0} 个内置扩展', items.length);
	}

	protected getEmptyText(): string {
		return localize('sidexExtensions.builtinEmpty', '没有发现内置扩展');
	}
}

class OpenSidexExtensionsAction extends Action2 {
	constructor() {
		super({
			id: 'sidexExtensions.open',
			title: localize2('sidexExtensions.open', '打开 SideX 扩展'),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IViewsService).openView(VIEW_ID, true);
	}
}

registerAction2(OpenSidexExtensionsAction);

const extensionsViewContainer = Registry.as<IViewContainersRegistry>(
	ViewExtensions.ViewContainersRegistry
).get(VIEWLET_ID);

const rustViewDescriptor: IViewDescriptor = {
	id: VIEW_ID,
	containerIcon: Codicon.chip,
	name: localize2('sidexExtensions.rustViewTitle', 'Rust 扩展'),
	ctorDescriptor: new SyncDescriptor(RustExtensionsView),
	when: ContextKeyExpr.and(DefaultViewsContext),
	canToggleVisibility: true,
	canMoveView: true,
	order: 2
};

const builtinViewDescriptor: IViewDescriptor = {
	id: BUILTIN_VIEW_ID,
	containerIcon: Codicon.library,
	name: localize2('sidexExtensions.builtinViewTitle', '内置扩展'),
	ctorDescriptor: new SyncDescriptor(BuiltinExtensionsView),
	when: ContextKeyExpr.and(DefaultViewsContext),
	canToggleVisibility: true,
	canMoveView: true,
	order: 3
};

if (extensionsViewContainer) {
	Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(
		[rustViewDescriptor, builtinViewDescriptor],
		extensionsViewContainer
	);
}

CommandsRegistry.registerCommand('rustExtensions.refresh', () => {
	void activeRustView?.refresh();
});

CommandsRegistry.registerCommand('builtinExtensions.refresh', () => {
	void activeBuiltinView?.refresh();
});

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: 'rustExtensions.refresh',
		title: localize('sidexExtensions.refresh', '刷新'),
		icon: { id: Codicon.refresh.id }
	},
	when: ContextKeyExpr.equals('view', VIEW_ID),
	group: 'navigation'
});

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: 'builtinExtensions.refresh',
		title: localize('sidexExtensions.refresh', '刷新'),
		icon: { id: Codicon.refresh.id }
	},
	when: ContextKeyExpr.equals('view', BUILTIN_VIEW_ID),
	group: 'navigation'
});
