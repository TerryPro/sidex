/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件列表内容状态的唯一持有者。
 *
 * 目录数据与搜索结果、它们各自的请求号都收在这里，对外只暴露「当前应展示的数据
 * + 加载态 + 整体版本」。视图不再自己比位置与搜索词，也就不会在搜索进行中
 * 误用上一次的结果重绘。
 *
 * 这里不依赖 DOM 与服务，可直接被 node:test 加载。
 */

import type { SideXExplorerEntry } from '../../../../platform/sidex/common/sidexExplorerService.js';

type Entries = readonly SideXExplorerEntry[];

/** 视图已渲染内容对应的元数据。 */
interface ViewMetadata {
	readonly renderedLocation: string | undefined;
	readonly renderedRefreshToken: number;
	readonly renderedQuery: string;
	readonly searchRoot: string | undefined;
}

/** 位置与刷新版本是否一致。 */
function isSameDirectory(
	location: string | undefined,
	refreshToken: number,
	otherLocation: string | undefined,
	otherRefreshToken: number
): boolean {
	return location === otherLocation && refreshToken === otherRefreshToken;
}

/** 视图已渲染的内容是否仍然对应当前标签、目录版本与搜索词。 */
function isViewCurrent(metadata: ViewMetadata, location: string, refreshToken: number, query: string): boolean {
	if (!isSameDirectory(location, refreshToken, metadata.renderedLocation, metadata.renderedRefreshToken)
		|| query !== metadata.renderedQuery) {
		return false;
	}
	// 搜索态还要求搜索根就是当前目录，防止切换目录后沿用旧结果。
	return query === '' || metadata.searchRoot === location;
}

interface DirectoryCache {
	readonly location: string;
	readonly refreshToken: number;
	readonly entries: Entries;
}

interface SearchCache {
	readonly location: string;
	readonly refreshToken: number;
	readonly query: string;
	readonly root: string;
	readonly results: Entries;
}

type PendingRequest =
	| { readonly kind: 'directory'; readonly location: string; readonly refreshToken: number }
	| { readonly kind: 'search'; readonly location: string; readonly refreshToken: number; readonly query: string; readonly root: string };

type Display =
	| { readonly kind: 'empty'; readonly location: string | undefined; readonly refreshToken: number }
	| { readonly kind: 'loading'; readonly request: PendingRequest }
	| { readonly kind: 'directory'; readonly cache: DirectoryCache }
	| { readonly kind: 'search'; readonly cache: SearchCache }
	| { readonly kind: 'error' };

export class DirectoryViewContent {

	private display: Display = { kind: 'empty', location: undefined, refreshToken: -1 };
	/** 目录缓存独立于当前展示保留，清空搜索时可直接复用。 */
	private directoryCache: DirectoryCache | undefined;
	/** 目录加载与搜索共用一个请求号：后发起的请求总是胜出。 */
	private requestId = 0;
	private version = 0;

	/** 数据整体版本；每次状态变化递增，供视图判断 DOM 是否还跟得上。 */
	get revision(): number {
		return this.version;
	}

	get loading(): boolean {
		return this.display.kind === 'loading';
	}

	/** 当前展示数据对应的目录；加载中为在途请求的目标目录。 */
	get location(): string | undefined {
		const display = this.display;
		switch (display.kind) {
			case 'empty':
				return display.location;
			case 'loading':
				return display.request.location;
			case 'directory':
				return display.cache.location;
			case 'search':
				return display.cache.location;
			default:
				return undefined;
		}
	}

	/** 当前展示的搜索根；undefined 表示普通目录列表。 */
	get searchRoot(): string | undefined {
		return this.display.kind === 'search' ? this.display.cache.root : undefined;
	}

	/** 当前展示数据对应的搜索词；目录列表为空串。 */
	get query(): string {
		return this.display.kind === 'search' ? this.display.cache.query : '';
	}

	/** 当前应展示的数据；加载中、出错或空视图时为 undefined。 */
	get entries(): Entries | undefined {
		const display = this.display;
		switch (display.kind) {
			case 'directory':
				return display.cache.entries;
			case 'search':
				return display.cache.results;
			default:
				return undefined;
		}
	}

	/** 当前展示内容是否已经对应当前标签与搜索词。 */
	isCurrent(location: string, refreshToken: number, query: string): boolean {
		if (this.display.kind === 'loading') {
			return false;
		}
		return isViewCurrent(
			{
				renderedLocation: this.location,
				renderedRefreshToken: this.displayedRefreshToken,
				renderedQuery: this.query,
				searchRoot: this.searchRoot
			},
			location,
			refreshToken,
			query
		);
	}

	private get displayedRefreshToken(): number {
		const display = this.display;
		switch (display.kind) {
			case 'empty':
				return display.refreshToken;
			case 'loading':
				return display.request.refreshToken;
			case 'directory':
				return display.cache.refreshToken;
			case 'search':
				return display.cache.refreshToken;
			default:
				return -1;
		}
	}

	/** 开始读取目录；返回的请求号必须原样交回 accept/fail。 */
	beginDirectoryLoad(location: string, refreshToken: number): number {
		this.directoryCache = undefined;
		this.display = { kind: 'loading', request: { kind: 'directory', location, refreshToken } };
		return this.nextRequest();
	}

	/** 开始搜索；返回的请求号必须原样交回 acceptSearch/fail。 */
	beginSearch(location: string, refreshToken: number, query: string): number {
		this.display = { kind: 'loading', request: { kind: 'search', location, refreshToken, query, root: location } };
		return this.nextRequest();
	}

	/** 接受目录读取结果；entries 为 undefined 表示「此电脑」这类没有文件数据的视图。 */
	accept(requestId: number, entries: Entries | undefined): boolean {
		const pending = this.pendingDirectory(requestId);
		if (!pending) {
			return false;
		}
		if (entries === undefined) {
			this.display = { kind: 'empty', location: pending.location, refreshToken: pending.refreshToken };
		} else {
			const cache: DirectoryCache = { location: pending.location, refreshToken: pending.refreshToken, entries };
			this.directoryCache = cache;
			this.display = { kind: 'directory', cache };
		}
		this.version++;
		return true;
	}

	/** 接受搜索结果。 */
	acceptSearch(requestId: number, results: Entries): boolean {
		const display = this.display;
		if (requestId !== this.requestId || display.kind !== 'loading' || display.request.kind !== 'search') {
			return false;
		}
		this.display = {
			kind: 'search',
			cache: {
				location: display.request.location,
				refreshToken: display.request.refreshToken,
				query: display.request.query,
				root: display.request.root,
				results
			}
		};
		this.version++;
		return true;
	}

	/** 标记在途请求失败；过期请求返回 false。 */
	fail(requestId: number): boolean {
		if (requestId !== this.requestId || this.display.kind !== 'loading') {
			return false;
		}
		this.display = { kind: 'error' };
		this.version++;
		return true;
	}

	/** 清空搜索后切回目录缓存；缓存不属于当前标签时返回 false。 */
	useDirectoryCache(location: string, refreshToken: number): boolean {
		const cache = this.directoryCache;
		if (!cache || !isSameDirectory(cache.location, cache.refreshToken, location, refreshToken)) {
			return false;
		}
		this.display = { kind: 'directory', cache };
		this.version++;
		return true;
	}

	/** 丢弃在途请求，例如视图随标签一起销毁时。 */
	invalidate(): void {
		this.requestId++;
	}

	private pendingDirectory(requestId: number): PendingRequest | undefined {
		const display = this.display;
		if (requestId !== this.requestId || display.kind !== 'loading' || display.request.kind !== 'directory') {
			return undefined;
		}
		return display.request;
	}

	private nextRequest(): number {
		this.requestId++;
		this.version++;
		return this.requestId;
	}
}
