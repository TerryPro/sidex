/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件列表排序的唯一实现。
 *
 * 这里只放纯函数：排序键与方向全部由调用方传入，不读编辑器状态，也不依赖 DOM，
 * 因此可以直接被 node:test 加载。
 */

import type { SideXExplorerEntry } from '../../../../platform/sidex/common/sidexExplorerService.js';

/** 可排序的列。 */
export type FileSortKey = 'name' | 'modified' | 'type' | 'size';

/**
 * 按指定列与方向排序，返回新数组，不修改入参。
 *
 * 目录恒在文件之前，方向只作用于同一分组内部。
 */
export function sortFileEntries(
	entries: readonly SideXExplorerEntry[],
	sortKey: FileSortKey,
	sortAscending: boolean
): SideXExplorerEntry[] {
	const factor = sortAscending ? 1 : -1;
	return [...entries].sort((a, b) => {
		if (a.isDir !== b.isDir) {
			return a.isDir ? -1 : 1;
		}
		switch (sortKey) {
			case 'modified':
				return (a.modified - b.modified) * factor;
			case 'size':
				return (a.size - b.size) * factor;
			case 'type': {
				const aType = a.isDir ? '' : a.name.slice(a.name.lastIndexOf('.') + 1);
				const bType = b.isDir ? '' : b.name.slice(b.name.lastIndexOf('.') + 1);
				return aType.localeCompare(bType) * factor;
			}
			default:
				return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * factor;
		}
	});
}
