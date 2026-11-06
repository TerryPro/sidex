/*---------------------------------------------------------------------------------------------
 *  SideX — 终端按目录标签隔离
 *
 *  每个目录标签拥有自己的一组终端会话：切换标签时把上一个标签的终端移入后台，
 *  再恢复目标标签的终端；首次在某标签打开终端面板时按该标签目录惰性创建。
 *  底部面板的显隐与高度仍然全局共享。
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { DirectoryTab, IDirectoryService } from './directoryService.js';

export class TerminalTabIsolationContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sidexTerminalIsolation';

	private readonly instancesByTab = new Map<string, ITerminalInstance[]>();
	private readonly activeByTab = new Map<string, ITerminalInstance>();
	private readonly initializedTabs = new Set<string>();
	private currentTabId: string | undefined;
	private syncing = false;

	constructor(
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();

		this.currentTabId = this.directoryService.activeTab?.id;
		this._register(this.directoryService.onDidChange(() => this.onDirectoryChange()));
		this._register(this.terminalService.onDidCreateInstance(instance => this.trackInstance(instance)));
		this._register(this.terminalService.onDidDisposeInstance(instance => this.forgetInstance(instance)));
		this._register(this.layoutService.onDidChangePartVisibility(event => {
			if (event.partId === Parts.PANEL_PART && event.visible) {
				const tab = this.directoryService.activeTab;
				if (tab) {
					void this.restoreTab(tab);
				}
			}
		}));
	}

	private onDirectoryChange(): void {
		const tab = this.directoryService.activeTab;
		if (!tab || tab.id === this.currentTabId) {
			return;
		}
		this.stashCurrentTab();
		this.currentTabId = tab.id;
		void this.applyCwd(tab.location);
		if (this.layoutService.isVisible(Parts.PANEL_PART)) {
			void this.restoreTab(tab);
		}
	}

	/** 把当前标签的终端全部移到后台，进程与滚动缓冲区保持不变。 */
	private stashCurrentTab(): void {
		const tabId = this.currentTabId;
		if (!tabId || this.syncing) {
			return;
		}
		const instances = this.terminalService.foregroundInstances
			.filter(instance => instance.target !== TerminalLocation.Editor && !instance.isDisposed);
		if (!instances.length) {
			return;
		}

		this.syncing = true;
		try {
			const stored = this.instancesByTab.get(tabId) ?? [];
			const active = this.terminalService.activeInstance;
			if (active) {
				this.activeByTab.set(tabId, active);
			}
			for (const instance of instances) {
				if (!stored.includes(instance)) {
					stored.push(instance);
				}
				this.terminalService.moveToBackground(instance);
			}
			this.instancesByTab.set(tabId, stored);
		} finally {
			this.syncing = false;
		}
	}

	private async restoreTab(tab: DirectoryTab): Promise<void> {
		const stored = (this.instancesByTab.get(tab.id) ?? []).filter(instance => !instance.isDisposed);
		this.instancesByTab.set(tab.id, stored);

		if (stored.length) {
			for (const instance of stored) {
				try {
					await this.terminalService.showBackgroundTerminal(instance);
				} catch (error) {
					console.error('[SideX] failed to restore terminal', error);
				}
			}
			const active = this.activeByTab.get(tab.id) ?? stored[0];
			if (active && !active.isDisposed) {
				this.terminalService.setActiveInstance(active);
			}
			return;
		}

		if (this.initializedTabs.has(tab.id)) {
			return;
		}
		this.initializedTabs.add(tab.id);
		await this.createTerminal(tab);
	}

	private async createTerminal(tab: DirectoryTab): Promise<void> {
		if (!tab.location || !this.terminalService.isProcessSupportRegistered) {
			return;
		}
		try {
			const instance = await this.terminalService.createTerminal({ cwd: URI.file(tab.location) });
			this.trackInstance(instance);
			this.terminalService.setActiveInstance(instance);
		} catch (error) {
			this.notificationService.warn(
				localize('sidex.terminal.createFailed', '无法为当前目录创建终端：{0}', String(error))
			);
		}
	}

	private trackInstance(instance: ITerminalInstance): void {
		if (instance.target === TerminalLocation.Editor) {
			return;
		}
		const tabId = this.currentTabId;
		if (!tabId) {
			return;
		}
		const stored = this.instancesByTab.get(tabId) ?? [];
		if (!stored.includes(instance)) {
			stored.push(instance);
		}
		this.instancesByTab.set(tabId, stored);
		this.initializedTabs.add(tabId);
	}

	private forgetInstance(instance: ITerminalInstance): void {
		for (const [tabId, stored] of this.instancesByTab) {
			const next = stored.filter(item => item !== instance);
			if (next.length !== stored.length) {
				this.instancesByTab.set(tabId, next);
			}
		}
		for (const [tabId, active] of this.activeByTab) {
			if (active === instance) {
				this.activeByTab.delete(tabId);
			}
		}
	}

	/** 新建终端时的默认目录跟随当前标签；只在内存中覆盖配置，不写入用户设置。 */
	private async applyCwd(location: string): Promise<void> {
		if (!location) {
			return;
		}
		try {
			await this.configurationService.updateValue(
				'terminal.integrated.cwd',
				location,
				ConfigurationTarget.MEMORY
			);
		} catch {
			// 个别版本不允许内存覆盖时保持原有默认目录。
		}
	}
}

registerWorkbenchContribution2(
	TerminalTabIsolationContribution.ID,
	TerminalTabIsolationContribution,
	WorkbenchPhase.AfterRestored
);
