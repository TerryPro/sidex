/*---------------------------------------------------------------------------------------------
 *  SideX — 标题栏第二行：前进/后退/向上/刷新 + 地址栏 + 搜索框
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, reset } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDirectoryService, normalizeLocation } from './directoryService.js';

interface IBreadcrumbSegment {
	readonly label: string;
	readonly location: string;
}

export class DirectoryNavBarControl extends Disposable {

	private readonly backButton: HTMLButtonElement;
	private readonly forwardButton: HTMLButtonElement;
	private readonly upButton: HTMLButtonElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly breadcrumb: HTMLElement;
	private readonly searchInput: HTMLInputElement;
	private readonly renderDisposables = this._register(new DisposableStore());

	constructor(
		private readonly container: HTMLElement,
		@IDirectoryService private readonly directoryService: IDirectoryService
	) {
		super();

		this.container.classList.add('sidex-explorer-navbar');

		const navigation = append(this.container, $('div.sidex-explorer-nav-actions'));

		this.backButton = this.createNavButton(navigation, 'codicon-arrow-left', localize('sidex.nav.back', '后退'));
		this.forwardButton = this.createNavButton(navigation, 'codicon-arrow-right', localize('sidex.nav.forward', '前进'));
		this.upButton = this.createNavButton(navigation, 'codicon-arrow-up', localize('sidex.nav.up', '向上一级'));
		this.refreshButton = this.createNavButton(navigation, 'codicon-refresh', localize('sidex.nav.refresh', '刷新'));

		this._register(addDisposableListener(this.backButton, EventType.CLICK, () => this.directoryService.goBack()));
		this._register(addDisposableListener(this.forwardButton, EventType.CLICK, () => this.directoryService.goForward()));
		this._register(addDisposableListener(this.upButton, EventType.CLICK, () => this.directoryService.goUp()));
		this._register(addDisposableListener(this.refreshButton, EventType.CLICK, () => this.directoryService.refresh()));

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
				this.searchInput.blur();
			}
		}));

		this._register(this.directoryService.onDidChange(() => this.update()));
		this.update();
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
