/*---------------------------------------------------------------------------------------------
 *  SideX — 资源管理器桥接服务：驱动器与目录读取。
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface SideXDriveInfo {
	/** 驱动器根路径，例如 `C:\\` */
	readonly path: string;
	/** 盘符，例如 `C:` */
	readonly letter: string;
	/** 卷标，可能为空 */
	readonly label: string;
	/** fixed / removable / network / cdrom / ramdisk / unknown */
	readonly kind: string;
	readonly totalBytes: number;
	readonly freeBytes: number;
}

export interface SideXExplorerEntry {
	readonly name: string;
	readonly path: string;
	readonly isDir: boolean;
	readonly size: number;
	readonly modified: number;
}

export interface SideXFileStat {
	readonly size: number;
	readonly isDir: boolean;
	readonly isFile: boolean;
	readonly isSymlink: boolean;
	readonly modified: number;
	readonly created: number;
	readonly readOnly: boolean;
}

export const ISideXExplorerService = createDecorator<ISideXExplorerService>('sidexExplorerService');

export interface ISideXExplorerService {
	readonly _serviceBrand: undefined;

	listDrives(): Promise<SideXDriveInfo[]>;
	readDirectory(path: string): Promise<SideXExplorerEntry[]>;
	/** 在 `root` 下递归按名称匹配文件与目录（不区分大小写）。 */
	searchEntries(root: string, query: string, maxResults?: number): Promise<SideXExplorerEntry[]>;
	stat(path: string): Promise<SideXFileStat>;

	createFile(path: string, content?: string): Promise<void>;
	createFolder(path: string): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	/** 移动到回收站，返回回收站条目 id（不可用时为 undefined）。 */
	moveToTrash(path: string): Promise<string | undefined>;
	/** 从回收站恢复指定条目；id 不可用时按原始路径回退。 */
	restoreFromTrash(id: string | undefined, path: string): Promise<void>;
	copy(source: string, destination: string, recursive?: boolean): Promise<void>;
	/** 移动文件或目录；跨盘时由 Rust 侧回退为复制后删除。 */
	movePath(source: string, destination: string): Promise<void>;
	/** 永久删除，不进回收站。 */
	remove(path: string, recursive: boolean): Promise<void>;
	exists(path: string): Promise<boolean>;
}
