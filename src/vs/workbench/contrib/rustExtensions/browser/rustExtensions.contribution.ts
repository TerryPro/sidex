/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/rustExtensions.css';

import { $ } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import {
	Extensions as ViewExtensions,
	IViewContainersRegistry,
	IViewDescriptor,
	IViewsRegistry,
	IViewDescriptorService,
	ViewContainerLocation
} from '../../../common/views.js';
import { IRustExtensionInfo, listRustExtensions, onDidChangeRustExtensions } from './rustExtensionsService.js';

const VIEW_CONTAINER_ID = 'workbench.view.rustExtensions';
const VIEW_ID = 'workbench.view.rustExtensions.view';

let activeView: RustExtensionsView | undefined;

function formatSize(bytes: number): string {
	if (!bytes) {
		return '—';
	}
	return bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.round(bytes / 1024)} KB`;
}

class RustExtensionsView extends ViewPane {
	static readonly ID = VIEW_ID;

	private rows!: HTMLElement;
	private summary!: HTMLElement;
	private readonly bodyDisposables = this._register(new DisposableStore());

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

		activeView = this;
		this._register({ dispose: () => { if (activeView === this) { activeView = undefined; } } });
		this.bodyDisposables.add(
			this.onDidChangeBodyVisibility(visible => {
				if (visible) {
					void this.refresh();
				}
			})
		);
		this.bodyDisposables.add(onDidChangeRustExtensions.event(() => void this.refresh()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.summary = $('.rust-ext-summary');
		this.rows = $('.rust-ext-list');
		container.appendChild(this.summary);
		container.appendChild(this.rows);
		void this.refresh();
	}

	async refresh(): Promise<void> {
		let extensions: IRustExtensionInfo[] = [];
		try {
			extensions = await listRustExtensions();
		} catch {
			return;
		}
		if (!this.rows) {
			return;
		}

		const loaded = extensions.filter(extension => extension.loaded).length;
		this.summary.textContent = localize(
			'rustExtensions.summary',
			'共 {0} 个 · 已加载 {1} 个',
			extensions.length,
			loaded
		);

		this.rows.replaceChildren();
		for (const extension of extensions) {
			this.rows.appendChild(this.renderRow(extension));
		}
	}

	private renderRow(extension: IRustExtensionInfo): HTMLElement {
		const row = $('.rust-ext-row');
		row.title = `${extension.path}\n${extension.wasmBinary}`;

		const icon = $('span.rust-ext-icon.codicon');
		icon.classList.add(extension.loaded ? 'codicon-extensions' : 'codicon-circle-large-outline');
		row.appendChild(icon);

		const info = $('.rust-ext-info');

		const title = $('.rust-ext-title');
		title.textContent = `${extension.name} · ${extension.id} · v${extension.version}`;
		info.appendChild(title);

		const meta = $('.rust-ext-meta');
		const events = extension.activationEvents.length ? extension.activationEvents.join(', ') : '常驻';
		meta.textContent = `${events} · ${formatSize(extension.sizeBytes)}`;
		info.appendChild(meta);

		row.appendChild(info);

		const badge = $('.rust-ext-badge');
		badge.classList.add(extension.loaded ? 'loaded' : 'idle');
		badge.textContent = extension.loaded
			? localize('rustExtensions.loaded', '已加载')
			: localize('rustExtensions.idle', '未加载');
		row.appendChild(badge);

		return row;
	}

	override dispose(): void {
		this.bodyDisposables.dispose();
		super.dispose();
	}
}

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer(
	{
		id: VIEW_CONTAINER_ID,
		title: localize2('rustExtensions.containerTitle', 'Rust 扩展'),
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		hideIfEmpty: false,
		icon: Codicon.extensions,
		order: 6
	},
	ViewContainerLocation.Sidebar,
	{ doNotRegisterOpenCommand: true }
);

const viewDescriptor: IViewDescriptor = {
	id: VIEW_ID,
	containerIcon: Codicon.extensions,
	name: localize2('rustExtensions.viewTitle', '已加载的 Rust 扩展'),
	ctorDescriptor: new SyncDescriptor(RustExtensionsView),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: container.id,
		mnemonicTitle: localize('rustExtensions.mnemonic', 'Rust 扩展'),
		order: 1
	}
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([viewDescriptor], container);

CommandsRegistry.registerCommand('rustExtensions.refresh', () => {
	void activeView?.refresh();
});

MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
	command: {
		id: 'rustExtensions.refresh',
		title: localize('rustExtensions.refresh', '刷新'),
		icon: { id: Codicon.refresh.id }
	},
	when: ContextKeyExpr.equals('view', VIEW_ID),
	group: 'navigation'
});
