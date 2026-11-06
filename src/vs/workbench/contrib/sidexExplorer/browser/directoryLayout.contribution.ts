/*---------------------------------------------------------------------------------------------
 *  SideX — 侧边栏宽度按目录标签保存
 *
 *  底部面板的显隐与高度是全局状态，不在这里处理。
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IDirectoryService } from './directoryService.js';

const MIN_SIDEBAR_WIDTH = 170;

export class DirectoryLayoutContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sidexDirectoryLayout';
	private static readonly STORAGE_KEY = 'sidex.directory.sidebarWidths';

	private widths = new Map<string, number>();
	private activeTabId: string | undefined;
	private saveTimer: number | undefined;
	private applying = false;

	constructor(
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.restoreWidths();
		this.activeTabId = this.directoryService.activeTab?.id;
		this._register(this.directoryService.onDidChange(() => this.onDirectoryChange()));
		this._register(this.layoutService.onDidLayoutMainContainer(() => this.scheduleSave()));
		this._register(this.layoutService.onDidChangePartVisibility(event => {
			if (event.partId === Parts.SIDEBAR_PART && event.visible) {
				this.applyWidth(this.activeTabId);
			}
		}));

		// 首帧布局完成后恢复当前标签的宽度。
		void this.layoutService.whenRestored.then(() => this.applyWidth(this.activeTabId));
	}

	override dispose(): void {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		this.saveActiveWidth();
		super.dispose();
	}

	private onDirectoryChange(): void {
		const next = this.directoryService.activeTab?.id;
		if (!next || next === this.activeTabId) {
			return;
		}
		this.saveActiveWidth();
		this.activeTabId = next;
		this.applyWidth(next);
	}

	private saveActiveWidth(): void {
		if (!this.activeTabId || this.applying || !this.layoutService.isVisible(Parts.SIDEBAR_PART)) {
			return;
		}
		const width = this.layoutService.getSize(Parts.SIDEBAR_PART).width;
		if (width >= MIN_SIDEBAR_WIDTH) {
			this.widths.set(this.activeTabId, Math.round(width));
			this.persistWidths();
		}
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) {
			return;
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined;
			this.saveActiveWidth();
		}, 300);
	}

	private applyWidth(tabId: string | undefined): void {
		const width = tabId ? this.widths.get(tabId) : undefined;
		if (!width || !this.layoutService.isVisible(Parts.SIDEBAR_PART)) {
			return;
		}
		const current = this.layoutService.getSize(Parts.SIDEBAR_PART);
		if (Math.abs(current.width - width) < 1) {
			return;
		}
		this.applying = true;
		try {
			this.layoutService.setSize(Parts.SIDEBAR_PART, { width, height: current.height });
		} finally {
			this.applying = false;
		}
	}

	private restoreWidths(): void {
		const raw = this.storageService.get(DirectoryLayoutContribution.STORAGE_KEY, StorageScope.PROFILE);
		if (!raw) {
			return;
		}
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			for (const [tabId, value] of Object.entries(parsed)) {
				const width = Number(value);
				if (Number.isFinite(width) && width >= MIN_SIDEBAR_WIDTH) {
					this.widths.set(tabId, width);
				}
			}
		} catch {
			// 损坏的数据不影响默认布局。
		}
	}

	private persistWidths(): void {
		this.storageService.store(
			DirectoryLayoutContribution.STORAGE_KEY,
			JSON.stringify(Object.fromEntries(this.widths)),
			StorageScope.PROFILE,
			StorageTarget.MACHINE
		);
	}
}

registerWorkbenchContribution2(
	DirectoryLayoutContribution.ID,
	DirectoryLayoutContribution,
	WorkbenchPhase.AfterRestored
);
