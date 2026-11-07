/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件类型判定的唯一来源。
 *
 * 这里只放纯函数：不依赖 DOM、不依赖任何 VS Code 服务。侧栏列表、缩略图、
 * 预览面板、拖拽导出都从这里取同一套扩展名表与格式化规则。
 */

/** sidex-asset 协议的统一来源。workbench 与资源协议不同源，图片需要 CORS。 */
export const ASSET_ORIGIN = 'https://sidex-asset.localhost';

/** 文件在 UI 里的广义类别。 */
export type FileKind = 'image' | 'video' | 'pdf' | 'text' | 'other';

/** 能生成缩略图的类别。 */
export type ThumbnailKind = 'image' | 'video' | 'pdf';

const IMAGE_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg'
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'wmv']);

const TEXT_EXTENSIONS = new Set([
	'txt', 'text', 'log', 'md', 'markdown', 'json', 'jsonc', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
	'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
	'rs', 'go', 'py', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'dart',
	'rb', 'php', 'lua', 'pl', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'sql', 'vue', 'svelte',
	'gradle', 'properties', 'env', 'csv', 'tsv', 'diff', 'patch'
]);

const TEXT_FILE_NAMES = new Set([
	'makefile', 'dockerfile', 'license', 'readme', 'changelog', '.gitignore', '.editorconfig'
]);

const THUMBNAIL_MAX_BYTES: Record<ThumbnailKind, number> = {
	image: 32 * 1024 * 1024,
	video: 512 * 1024 * 1024,
	pdf: 64 * 1024 * 1024
};

/** 取小写扩展名（不含点）。无扩展名或隐藏文件返回空串。 */
export function extensionOf(name: string): string {
	const index = name.lastIndexOf('.');
	return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function classifyFile(name: string): FileKind {
	const extension = extensionOf(name);
	if (IMAGE_EXTENSIONS.has(extension)) {
		return 'image';
	}
	if (VIDEO_EXTENSIONS.has(extension)) {
		return 'video';
	}
	if (extension === 'pdf') {
		return 'pdf';
	}
	if (TEXT_EXTENSIONS.has(extension) || (extension === '' && TEXT_FILE_NAMES.has(name.toLowerCase()))) {
		return 'text';
	}
	return 'other';
}

/** 可渲染 Markdown 富文本预览的文件。 */
export function isMarkdownFile(name: string): boolean {
	const extension = extensionOf(name);
	return extension === 'md' || extension === 'markdown';
}

/** 可渲染 Mermaid 图表的文件。 */
export function isMermaidFile(name: string): boolean {
	const extension = extensionOf(name);
	return extension === 'mmd' || extension === 'mermaid';
}

/** 缩略图类别；不可生成缩略图时返回 undefined。 */
export function thumbnailKindOf(name: string): ThumbnailKind | undefined {
	const kind = classifyFile(name);
	return kind === 'image' || kind === 'video' || kind === 'pdf' ? kind : undefined;
}

/** 缩略图允许的最大原始文件字节数。 */
export function maxThumbnailBytes(kind: ThumbnailKind): number {
	return THUMBNAIL_MAX_BYTES[kind];
}

/** 图片 MIME；未知扩展名返回 undefined。 */
export function imageMime(name: string): string | undefined {
	switch (extensionOf(name)) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'gif':
			return 'image/gif';
		case 'bmp':
			return 'image/bmp';
		case 'webp':
			return 'image/webp';
		case 'ico':
			return 'image/x-icon';
		case 'svg':
			return 'image/svg+xml';
		default:
			return undefined;
	}
}

/** sidex-asset 绝对地址；`version` 存在时附加 `?v=` 用于缓存失效。 */
export function assetUrl(path: string, version?: number): string {
	const normalized = path.replace(/\\/g, '/').split('/').map(segment => encodeURIComponent(segment)).join('/');
	const query = version === undefined ? '' : `?v=${version}`;
	return `${ASSET_ORIGIN}/${normalized}${query}`;
}

/** 字节数转人类可读字符串。 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / Math.pow(1024, index);
	const decimals = index >= 3 ? 1 : 0;
	return `${value.toFixed(decimals)} ${units[index]}`;
}
