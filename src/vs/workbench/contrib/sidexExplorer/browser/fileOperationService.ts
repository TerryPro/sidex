/*---------------------------------------------------------------------------------------------
 *  SideX — 文件操作服务：撤销栈、冲突处理与批量进度/取消。
 *
 *  撤销栈只保存在内存中，关闭应用后清空；最多保留最近 20 步。
 *  所有会改变磁盘的操作都从这里走，保证右键菜单、快捷键与拖放行为一致。
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { ISideXExplorerService } from '../../../../platform/sidex/common/sidexExplorerService.js';

export type FileOperationMode = 'copy' | 'move';

/** 应用内拖拽使用的自定义 MIME，携带 JSON 路径数组。 */
export const SIDEX_FILES_MIME = 'application/x-sidex-files';

export interface FileOperationError {
	readonly path: string;
	readonly error: string;
}

export interface FileOperationResult {
	readonly completed: number;
	readonly skipped: number;
	readonly cancelled: boolean;
	readonly failed: readonly FileOperationError[];
}

export interface FileClipboard {
	readonly paths: readonly string[];
	readonly cut: boolean;
}

interface UndoTrashItem {
	readonly path: string;
	readonly id?: string;
}

type UndoEntry =
	| { readonly kind: 'rename'; readonly from: string; readonly to: string }
	| { readonly kind: 'trash'; readonly items: readonly UndoTrashItem[] }
	| { readonly kind: 'copy'; readonly created: readonly string[] }
	| { readonly kind: 'move'; readonly items: readonly { readonly from: string; readonly to: string }[] };

const MAX_UNDO_ENTRIES = 20;

export const IFileOperationService = createDecorator<IFileOperationService>('sidexFileOperationService');

export interface IFileOperationService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeUndoState: Event<void>;
	readonly onDidChangeClipboard: Event<void>;

	readonly clipboard: FileClipboard | undefined;

	canUndo(): boolean;
	undo(): Promise<void>;

	setClipboard(paths: readonly string[], cut: boolean): void;
	clearClipboard(): void;

	rename(path: string, newPath: string): Promise<void>;
	trash(paths: readonly string[]): Promise<FileOperationResult>;
	deletePermanently(paths: readonly string[]): Promise<FileOperationResult>;
	copy(sources: readonly string[], targetDirectory: string): Promise<FileOperationResult>;
	move(sources: readonly string[], targetDirectory: string): Promise<FileOperationResult>;
	/** `auto` 按盘符判断：同盘移动，跨盘复制。 */
	moveOrCopy(sources: readonly string[], targetDirectory: string, mode?: FileOperationMode | 'auto'): Promise<FileOperationResult>;
	paste(targetDirectory: string): Promise<FileOperationResult>;
}

export function fileName(path: string): string {
	const normalized = path.replace(/\//g, '\\').replace(/\\+$/, '');
	const index = normalized.lastIndexOf('\\');
	return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function parentDirectory(path: string): string {
	const normalized = path.replace(/\//g, '\\').replace(/\\+$/, '');
	const index = normalized.lastIndexOf('\\');
	if (index < 0) {
		return '';
	}
	const parent = normalized.slice(0, index);
	return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export function joinPath(directory: string, name: string): string {
	if (!directory) {
		return name;
	}
	return directory.endsWith('\\') || directory.endsWith('/') ? `${directory}${name}` : `${directory}\\${name}`;
}

function driveOf(path: string): string {
	const match = /^([A-Za-z]):/.exec(path);
	return match ? match[1].toLowerCase() : '';
}

function splitName(name: string): { base: string; extension: string } {
	const index = name.lastIndexOf('.');
	if (index <= 0) {
		return { base: name, extension: '' };
	}
	return { base: name.slice(0, index), extension: name.slice(index) };
}

class FileOperationService extends Disposable implements IFileOperationService {
	declare readonly _serviceBrand: undefined;

	private readonly undoStack: UndoEntry[] = [];
	private _clipboard: FileClipboard | undefined;

	private readonly _onDidChangeUndoState = this._register(new Emitter<void>());
	readonly onDidChangeUndoState = this._onDidChangeUndoState.event;

	private readonly _onDidChangeClipboard = this._register(new Emitter<void>());
	readonly onDidChangeClipboard = this._onDidChangeClipboard.event;

	constructor(
		@ISideXExplorerService private readonly explorerService: ISideXExplorerService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super();
	}

	get clipboard(): FileClipboard | undefined {
		return this._clipboard;
	}

	setClipboard(paths: readonly string[], cut: boolean): void {
		this._clipboard = paths.length ? { paths: [...paths], cut } : undefined;
		this._onDidChangeClipboard.fire();
	}

	clearClipboard(): void {
		if (!this._clipboard) {
			return;
		}
		this._clipboard = undefined;
		this._onDidChangeClipboard.fire();
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	async rename(path: string, newPath: string): Promise<void> {
		await this.explorerService.rename(path, newPath);
		this.pushUndo({ kind: 'rename', from: path, to: newPath });
	}

	async trash(paths: readonly string[]): Promise<FileOperationResult> {
		const failed: FileOperationError[] = [];
		const items: UndoTrashItem[] = [];
		for (const path of paths) {
			try {
				const id = await this.explorerService.moveToTrash(path);
				items.push({ path, id });
			} catch (error) {
				failed.push({ path, error: this.message(error) });
			}
		}
		if (items.length) {
			this.pushUndo({ kind: 'trash', items });
		}
		return { completed: items.length, skipped: 0, cancelled: false, failed };
	}

	async deletePermanently(paths: readonly string[]): Promise<FileOperationResult> {
		const failed: FileOperationError[] = [];
		let completed = 0;
		for (const path of paths) {
			try {
				await this.explorerService.remove(path, true);
				completed++;
			} catch (error) {
				failed.push({ path, error: this.message(error) });
			}
		}
		return { completed, skipped: 0, cancelled: false, failed };
	}

	async copy(sources: readonly string[], targetDirectory: string): Promise<FileOperationResult> {
		return this.run('copy', sources, targetDirectory);
	}

	async move(sources: readonly string[], targetDirectory: string): Promise<FileOperationResult> {
		return this.run('move', sources, targetDirectory);
	}

	async moveOrCopy(
		sources: readonly string[],
		targetDirectory: string,
		mode: FileOperationMode | 'auto' = 'auto'
	): Promise<FileOperationResult> {
		if (!targetDirectory) {
			return { completed: 0, skipped: sources.length, cancelled: false, failed: [] };
		}
		if (mode === 'auto') {
			// 同盘默认移动，跨盘默认复制；混选时按每个来源分别处理。
			const moves = sources.filter(source => driveOf(source) === driveOf(targetDirectory));
			const copies = sources.filter(source => driveOf(source) !== driveOf(targetDirectory));
			const moved = moves.length ? await this.run('move', moves, targetDirectory) : undefined;
			const copied = copies.length ? await this.run('copy', copies, targetDirectory) : undefined;
			return mergeResults(moved, copied);
		}
		return this.run(mode, sources, targetDirectory);
	}

	async paste(targetDirectory: string): Promise<FileOperationResult> {
		const clipboard = this._clipboard;
		if (!clipboard?.paths.length) {
			return { completed: 0, skipped: 0, cancelled: false, failed: [] };
		}
		const result = await this.run(clipboard.cut ? 'move' : 'copy', clipboard.paths, targetDirectory);
		if (clipboard.cut && result.completed > 0) {
			this.clearClipboard();
		}
		return result;
	}

	async undo(): Promise<void> {
		const entry = this.undoStack.pop();
		if (!entry) {
			return;
		}
		try {
			switch (entry.kind) {
				case 'rename':
					await this.explorerService.rename(entry.to, entry.from);
					break;
				case 'trash':
					for (const item of entry.items) {
						await this.explorerService.restoreFromTrash(item.id, item.path);
					}
					break;
				case 'copy':
					for (const created of entry.created) {
						await this.explorerService.remove(created, true);
					}
					break;
				case 'move':
					for (const item of [...entry.items].reverse()) {
						await this.explorerService.movePath(item.to, item.from);
					}
					break;
			}
			this._onDidChangeUndoState.fire();
		} catch (error) {
			// 撤销失败时保留记录，方便用户处理冲突后重试。
			this.undoStack.push(entry);
			this.notificationService.error(
				localize('sidex.fileOp.undoFailed', '撤销失败：{0}', this.message(error))
			);
		}
	}

	private pushUndo(entry: UndoEntry): void {
		this.undoStack.push(entry);
		while (this.undoStack.length > MAX_UNDO_ENTRIES) {
			this.undoStack.shift();
		}
		this._onDidChangeUndoState.fire();
	}

	private async run(
		mode: FileOperationMode,
		sources: readonly string[],
		targetDirectory: string
	): Promise<FileOperationResult> {
		const failed: FileOperationError[] = [];
		const completedPairs: { from: string; to: string }[] = [];
		let skipped = 0;
		let cancelled = false;

		const candidates = [...new Set(sources)].filter(source => {
			const name = fileName(source);
			if (!name || !targetDirectory) {
				return false;
			}
			if (parentDirectory(source).toLowerCase() === targetDirectory.toLowerCase()) {
				return false;
			}
			// 禁止把目录移动到自身内部。
			const normalizedSource = source.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
			const normalizedTarget = targetDirectory.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
			return !normalizedTarget.startsWith(`${normalizedSource}\\`);
		});

		if (!candidates.length) {
			return { completed: 0, skipped: sources.length, cancelled: false, failed };
		}

		const conflictCts = new CancellationTokenSource();
		let batchResolution: 'replace' | 'skip' | 'rename' | undefined;

		const processOne = async (source: string): Promise<'done' | 'skip' | 'cancel'> => {
			const name = fileName(source);
			let destination = joinPath(targetDirectory, name);
			const exists = await this.explorerService.exists(destination).catch(() => false);
			if (exists) {
				let resolution: 'replace' | 'skip' | 'rename' | 'cancel' | undefined = batchResolution;
				if (!resolution) {
					const choice = await this.askConflict(source, destination);
					resolution = choice.resolution;
					if (choice.applyToAll && choice.resolution !== 'cancel') {
						batchResolution = choice.resolution;
					}
				}
				if (resolution === 'cancel') {
					return 'cancel';
				}
				if (resolution === 'skip') {
					return 'skip';
				}
				if (resolution === 'rename') {
					destination = await this.uniqueDestination(targetDirectory, name);
				} else if (resolution === 'replace') {
					await this.explorerService.remove(destination, true);
				}
			}

			try {
				if (mode === 'copy') {
					await this.explorerService.copy(source, destination, true);
				} else {
					await this.explorerService.movePath(source, destination);
				}
				completedPairs.push({ from: source, to: destination });
				return 'done';
			} catch (error) {
				failed.push({ path: source, error: this.message(error) });
				return 'done';
			}
		};

		if (candidates.length === 1) {
			const outcome = await processOne(candidates[0]);
			if (outcome === 'cancel') {
				cancelled = true;
			} else if (outcome === 'skip') {
				skipped++;
			}
		} else {
			const title = mode === 'copy'
				? localize('sidex.fileOp.copying', '正在复制 {0} 个项目', candidates.length)
				: localize('sidex.fileOp.moving', '正在移动 {0} 个项目', candidates.length);
			await this.progressService.withProgress(
				{
					location: ProgressLocation.Notification,
					title,
					cancellable: true,
					total: candidates.length
				},
				async progress => {
					for (const source of candidates) {
						if (conflictCts.token.isCancellationRequested) {
							cancelled = true;
							break;
						}
						progress.report({ message: fileName(source), increment: 1 });
						const outcome = await processOne(source);
						if (outcome === 'cancel') {
							cancelled = true;
							break;
						}
						if (outcome === 'skip') {
							skipped++;
						}
					}
				},
				() => conflictCts.cancel()
			);
		}

		if (completedPairs.length) {
			if (mode === 'copy') {
				this.pushUndo({ kind: 'copy', created: completedPairs.map(pair => pair.to) });
			} else {
				this.pushUndo({ kind: 'move', items: completedPairs });
			}
		}

		if (cancelled) {
			this.notificationService.info(
				localize('sidex.fileOp.cancelled', '操作已取消，已完成 {0} 项', completedPairs.length)
			);
		}
		if (failed.length) {
			this.notificationService.warn(
				localize(
					'sidex.fileOp.partialFailed',
					'有 {0} 个项目未能完成：{1}',
					failed.length,
					failed.map(item => `${item.path}: ${item.error}`).join('；')
				)
			);
		}

		return { completed: completedPairs.length, skipped, cancelled, failed };
	}

	private async askConflict(
		source: string,
		destination: string
	): Promise<{ resolution: 'replace' | 'skip' | 'rename' | 'cancel'; applyToAll: boolean }> {
		const { result, checkboxChecked } = await this.dialogService.prompt<'replace' | 'skip' | 'rename' | 'cancel'>({
			type: 'question',
			message: localize('sidex.fileOp.conflictTitle', '目标位置已存在“{0}”', fileName(destination)),
			detail: localize('sidex.fileOp.conflictDetail', '来源：{0}\n目标：{1}', source, destination),
			buttons: [
				{
					label: localize('sidex.fileOp.replace', '替换目标'),
					run: () => 'replace' as const
				},
				{
					label: localize('sidex.fileOp.skip', '跳过'),
					run: () => 'skip' as const
				},
				{
					label: localize('sidex.fileOp.rename', '保留两者'),
					run: () => 'rename' as const
				}
			],
			cancelButton: {
				label: localize('sidex.fileOp.cancel', '取消'),
				run: () => 'cancel' as const
			},
			checkbox: {
				label: localize('sidex.fileOp.applyToAll', '对后续冲突使用相同操作')
			}
		});
		return { resolution: result ?? 'cancel', applyToAll: checkboxChecked === true };
	}

	private async uniqueDestination(directory: string, name: string): Promise<string> {
		const { base, extension } = splitName(name);
		for (let index = 2; index < 10000; index++) {
			const candidate = joinPath(directory, `${base} (${index})${extension}`);
			if (!await this.explorerService.exists(candidate).catch(() => false)) {
				return candidate;
			}
		}
		return joinPath(directory, `${base} (${Date.now()})${extension}`);
	}

	private message(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}

function mergeResults(
	left: FileOperationResult | undefined,
	right: FileOperationResult | undefined
): FileOperationResult {
	return {
		completed: (left?.completed ?? 0) + (right?.completed ?? 0),
		skipped: (left?.skipped ?? 0) + (right?.skipped ?? 0),
		cancelled: (left?.cancelled ?? false) || (right?.cancelled ?? false),
		failed: [...(left?.failed ?? []), ...(right?.failed ?? [])]
	};
}

registerSingleton(IFileOperationService, FileOperationService, InstantiationType.Delayed);
