/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件列表的查看模式与视图状态。
 *
 * 这里只放纯函数：不读服务、不依赖 DOM，便于 node:test 直接加载。
 */

import type { SideXExplorerEntry } from '../../../../platform/sidex/common/sidexExplorerService.js';
import type { FileSortKey } from './fileListSort.js';

/** 查看模式：详细信息、列表、图标。 */
export type FileViewMode = 'details' | 'list' | 'icons';

/** 一个目录标签的排序与查看状态。 */
export interface FileViewState {
	readonly sortKey: FileSortKey;
	readonly sortAscending: boolean;
	readonly viewMode: FileViewMode;
}

export const DEFAULT_FILE_VIEW_STATE: FileViewState = {
	sortKey: 'name',
	sortAscending: true,
	viewMode: 'details'
};

const SORT_KEYS: readonly FileSortKey[] = ['name', 'modified', 'type', 'size'];
const VIEW_MODES: readonly FileViewMode[] = ['details', 'list', 'icons'];

function isSortKey(value: unknown): value is FileSortKey {
	return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);
}

function isViewMode(value: unknown): value is FileViewMode {
	return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

/** 把任意持久化值收敛成合法状态，缺省项回退默认值。 */
export function normalizeFileViewState(raw: unknown): FileViewState {
	if (!raw || typeof raw !== 'object') {
		return DEFAULT_FILE_VIEW_STATE;
	}
	const value = raw as Record<string, unknown>;
	return {
		sortKey: isSortKey(value.sortKey) ? value.sortKey : DEFAULT_FILE_VIEW_STATE.sortKey,
		sortAscending: typeof value.sortAscending === 'boolean'
			? value.sortAscending
			: DEFAULT_FILE_VIEW_STATE.sortAscending,
		viewMode: isViewMode(value.viewMode) ? value.viewMode : DEFAULT_FILE_VIEW_STATE.viewMode
	};
}

/** 解析「目录标签 → 视图状态」的 JSON 记录；非法项直接丢弃。 */
export function parseFileViewStates(raw: string | undefined): Record<string, FileViewState> {
	if (!raw) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}
	const result: Record<string, FileViewState> = {};
	for (const [tabId, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (tabId) {
			result[tabId] = normalizeFileViewState(value);
		}
	}
	return result;
}

/** 去掉最后一个扩展名；点号在首位或没有点号时保持原样。 */
export function stripFileExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

/** 列表显示名：目录始终显示全名，文件按开关决定是否隐藏扩展名。 */
export function displayEntryName(entry: Pick<SideXExplorerEntry, 'name' | 'isDir'>, showExtensions: boolean): string {
	if (entry.isDir || showExtensions) {
		return entry.name;
	}
	return stripFileExtension(entry.name);
}
