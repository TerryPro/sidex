/*---------------------------------------------------------------------------------------------
 *  SideX — 系统拖入：把资源管理器里的文件拖进 SideX。
 *
 *  Tauri 的原生拖放事件不携带 HTML5 dataTransfer，因此用屏幕坐标定位目标文件夹；
 *  Ctrl / Shift 修饰键通过 Rust 侧读取系统键盘状态。
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IDirectoryService } from './directoryService.js';
import { IFileOperationService, parentDirectory } from './fileOperationService.js';

interface IDropTarget {
	readonly directory: string;
	readonly element: HTMLElement;
}

export class SystemDragDropContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sidexSystemDragDrop';

	private unlisten: (() => void) | undefined;
	private highlighted: HTMLElement | undefined;

	constructor(
		@IDirectoryService private readonly directoryService: IDirectoryService,
		@IFileOperationService private readonly fileOperationService: IFileOperationService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		void this.initialize();
	}

	override dispose(): void {
		this.unlisten?.();
		this.unlisten = undefined;
		this.clearHighlight();
		super.dispose();
	}

	private async initialize(): Promise<void> {
		if (!(globalThis as any).__SIDEX_TAURI__) {
			return;
		}
		try {
			const webview = getCurrentWebview();
			this.unlisten = await webview.onDragDropEvent(event => {
				const payload = event.payload;
				if (payload.type === 'over') {
					this.highlightAt(payload.position.x, payload.position.y);
				} else if (payload.type === 'leave') {
					this.clearHighlight();
				} else if (payload.type === 'drop') {
					void this.handleDrop(payload.paths, payload.position.x, payload.position.y);
				}
			});
		} catch (error) {
			console.error('[SideX] system drag-drop unavailable', error);
		}
	}

	private async handleDrop(paths: readonly string[], physicalX: number, physicalY: number): Promise<void> {
		this.clearHighlight();
		if (!paths.length) {
			return;
		}
		const { x, y } = this.toClientPoint(physicalX, physicalY);
		const target = this.targetAt(x, y);
		if (!target) {
			this.notificationService.warn(
				localize('sidex.systemDrop.noTarget', '请把文件拖到文件夹、文件列表或目录标签上')
			);
			return;
		}

		let mode: 'auto' | 'copy' | 'move' = 'auto';
		try {
			const modifiers = await invoke<{ control: boolean; shift: boolean }>('get_modifier_keys');
			if (modifiers.control) {
				mode = 'copy';
			} else if (modifiers.shift) {
				mode = 'move';
			}
		} catch {
			// 读取修饰键失败时使用默认的同盘移动、跨盘复制。
		}

		await this.fileOperationService.moveOrCopy(paths, target.directory, mode);

		const normalized = target.directory.toLowerCase();
		const targetTab = this.directoryService.tabs.find(tab => tab.location.toLowerCase() === normalized);
		if (targetTab) {
			this.directoryService.refreshTab(targetTab.id);
		} else {
			this.directoryService.refresh();
		}
	}

	private toClientPoint(physicalX: number, physicalY: number): { x: number; y: number } {
		const scale = window.devicePixelRatio || 1;
		return { x: physicalX / scale, y: physicalY / scale };
	}

	private highlightAt(physicalX: number, physicalY: number): void {
		const { x, y } = this.toClientPoint(physicalX, physicalY);
		const target = this.targetAt(x, y);
		if (this.highlighted === target?.element) {
			return;
		}
		this.clearHighlight();
		if (target) {
			this.highlighted = target.element;
			target.element.classList.add('drop-target');
		}
	}

	private clearHighlight(): void {
		this.highlighted?.classList.remove('drop-target');
		this.highlighted = undefined;
	}

	private targetAt(x: number, y: number): IDropTarget | undefined {
		const element = document.elementFromPoint(x, y) as HTMLElement | null;
		if (!element) {
			return undefined;
		}

		const row = element.closest('.sidex-file-row') as HTMLElement | null;
		if (row?.dataset.path) {
			const path = row.dataset.path;
			const directory = row.dataset.isDir === 'true' ? path : parentDirectory(path);
			return directory ? { directory, element: row } : undefined;
		}

		const tab = element.closest('.sidex-directory-tab') as HTMLElement | null;
		if (tab?.dataset.location) {
			return { directory: tab.dataset.location, element: tab };
		}

		const content = element.closest('.sidex-directory-content') as HTMLElement | null;
		if (content?.dataset.location) {
			return { directory: content.dataset.location, element: content };
		}

		return undefined;
	}
}

registerWorkbenchContribution2(
	SystemDragDropContribution.ID,
	SystemDragDropContribution,
	WorkbenchPhase.AfterRestored
);
