/*---------------------------------------------------------------------------------------------
 *  SideX — 标题栏目录标签（资源管理器风格）
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, reset } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDirectoryService, normalizeLocation } from './directoryService.js';
import { driveIconSvg, folderIconSvg, pcIconSvg } from './explorerIcons.js';
import { IFileOperationService, SIDEX_FILES_MIME } from './fileOperationService.js';

export class DirectoryTabsControl extends Disposable {

	private readonly renderDisposables = this._register(new DisposableStore());

	constructor(
		private readonly container: HTMLElement,
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@IFileOperationService private readonly fileOperationService: IFileOperationService
	) {
		super();

		this.container.classList.add('sidex-directory-tabs');
		this._register(this.directoryService.onDidChange(() => this.render()));
		// 双击标签栏空白区域新建一个「此电脑」标签，和资源管理器一致。
		this._register(addDisposableListener(this.container, EventType.DBLCLICK, event => {
			if (event.target === this.container) {
				this.directoryService.addTab('');
			}
		}));

		this.render();
	}

	private render(): void {
		this.renderDisposables.clear();
		reset(this.container);

		for (const tab of this.directoryService.tabs) {
			const active = this.directoryService.activeTab?.id === tab.id;

			const tabElement = $('div.sidex-directory-tab');
			if (active) {
				tabElement.classList.add('active');
			}
			tabElement.setAttribute('role', 'tab');
			tabElement.setAttribute('aria-selected', active ? 'true' : 'false');
			tabElement.title = tab.title || tab.location;
			tabElement.dataset.location = tab.location;

			const icon = $('span.sidex-directory-tab-icon');
			icon.innerHTML = this.iconFor(tab.location);
			tabElement.appendChild(icon);

			const title = $('span.sidex-directory-tab-title');
			title.textContent = tab.title;
			tabElement.appendChild(title);

			const close = $('span.sidex-directory-tab-close');
			close.textContent = '×';
			close.title = localize('sidex.directory.closeTab', '关闭标签');
			close.setAttribute('role', 'button');
			tabElement.appendChild(close);

			this.renderDisposables.add(addDisposableListener(tabElement, EventType.CLICK, event => {
				if (event.target === close) {
					return;
				}
				this.directoryService.activateTab(tab.id);
			}));
			this.renderDisposables.add(addDisposableListener(close, EventType.CLICK, event => {
				event.stopPropagation();
				this.directoryService.closeTab(tab.id);
			}));
			this.renderDisposables.add(addDisposableListener(tabElement, EventType.AUXCLICK, event => {
				if (event.button === 1) {
					event.preventDefault();
					this.directoryService.closeTab(tab.id);
				}
			}));

			// 拖到目录标签：把文件移动/复制到该标签的目录并切换过去。
			this.renderDisposables.add(addDisposableListener(tabElement, EventType.DRAG_OVER, event => {
				if (!tab.location || !event.dataTransfer) {
					return;
				}
				if (!Array.from(event.dataTransfer.types).includes(SIDEX_FILES_MIME)) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
				tabElement.classList.add('drop-target');
			}));
			this.renderDisposables.add(addDisposableListener(tabElement, EventType.DRAG_LEAVE, () => {
				tabElement.classList.remove('drop-target');
			}));
			this.renderDisposables.add(addDisposableListener(tabElement, EventType.DROP, event => {
				tabElement.classList.remove('drop-target');
				if (!tab.location || !event.dataTransfer) {
					return;
				}
				const raw = event.dataTransfer.getData(SIDEX_FILES_MIME);
				if (!raw) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				let paths: string[] = [];
				try {
					const parsed = JSON.parse(raw);
					if (Array.isArray(parsed)) {
						paths = parsed.filter((item): item is string => typeof item === 'string');
					}
				} catch {
					return;
				}
				if (!paths.length) {
					return;
				}
				const mode = event.ctrlKey ? 'copy' : event.shiftKey ? 'move' : 'auto';
				void this.fileOperationService.moveOrCopy(paths, tab.location, mode).then(() => {
					this.directoryService.refreshTab(tab.id);
					this.directoryService.activateTab(tab.id);
				});
			}));

			this.container.appendChild(tabElement);
		}

		const addButton = $('button.sidex-directory-tab-add');
		addButton.textContent = '+';
		addButton.title = localize('sidex.directory.newTab', '新建标签');
		this.renderDisposables.add(addDisposableListener(addButton, EventType.CLICK, () => this.directoryService.addTab('')));
		this.container.appendChild(addButton);
	}

	private iconFor(location: string): string {
		if (!location) {
			return pcIconSvg();
		}
		const normalized = normalizeLocation(location);
		if (/^[A-Za-z]:\\$/.test(normalized)) {
			const drive = this.directoryService.drives.find(item => normalizeLocation(item.path).toLowerCase() === normalized.toLowerCase());
			return driveIconSvg(drive?.kind ?? 'fixed');
		}
		return folderIconSvg();
	}
}
