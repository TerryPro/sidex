/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件列表视图「是否已是最新」的唯一判据。
 *
 * 这里只放纯判据：把位置、刷新版本、搜索词与搜索根放在一起比较，避免各处
 * 各写一套残本比对导致行为漂移。不依赖 DOM，可直接被 node:test 加载。
 */

/** 视图已渲染内容对应的元数据。 */
export interface DirectoryViewMetadata {
	readonly renderedLocation: string | undefined;
	readonly renderedRefreshToken: number;
	readonly renderedQuery: string;
	readonly searchRoot: string | undefined;
}

/** 目录标签的当前元数据。 */
export interface DirectoryTabMetadata {
	readonly location: string;
	readonly refreshToken: number;
}

/** 已缓存的数据集是否仍属于当前标签（位置与刷新版本都一致）。 */
export function isDirectoryDataCurrent(view: DirectoryViewMetadata, tab: DirectoryTabMetadata): boolean {
	return tab.location === view.renderedLocation && tab.refreshToken === view.renderedRefreshToken;
}

/**
 * 视图已渲染的内容是否仍然对应当前标签、目录版本与搜索词。
 *
 * 搜索态还要求搜索根就是当前目录，防止切换目录后沿用旧结果。
 */
export function isDirectoryViewCurrent(
	view: DirectoryViewMetadata,
	tab: DirectoryTabMetadata,
	query: string
): boolean {
	if (!isDirectoryDataCurrent(view, tab) || query !== view.renderedQuery) {
		return false;
	}
	return query === '' || view.searchRoot === tab.location;
}
