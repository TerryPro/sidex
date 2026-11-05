/*---------------------------------------------------------------------------------------------
 *  SideX — 资源管理器桥接服务实现（通过 Tauri IPC 访问 Rust 文件系统）。
 *--------------------------------------------------------------------------------------------*/

// Tauri 2：直接使用官方 API 模块，window.__TAURI__ 默认不暴露。
import { invoke } from '@tauri-apps/api/core';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import {
	ISideXExplorerService,
	SideXDriveInfo,
	SideXExplorerEntry,
	SideXFileStat
} from '../common/sidexExplorerService.js';

export class SideXExplorerService implements ISideXExplorerService {
	declare readonly _serviceBrand: undefined;

	async listDrives(): Promise<SideXDriveInfo[]> {
		const drives = await invoke<SideXDriveInfo[]>('list_drives');
		if (!Array.isArray(drives)) {
			return [];
		}
		return drives.map(drive => ({
			path: String(drive.path ?? ''),
			letter: String(drive.letter ?? ''),
			label: String(drive.label ?? ''),
			kind: String(drive.kind ?? 'unknown'),
			totalBytes: Number(drive.totalBytes ?? 0),
			freeBytes: Number(drive.freeBytes ?? 0)
		}));
	}

	async readDirectory(path: string): Promise<SideXExplorerEntry[]> {
		const entries = await invoke<Array<{
			name: string;
			path: string;
			is_dir: boolean;
			size: number;
			modified: number;
		}>>('read_dir', { path });
		if (!Array.isArray(entries)) {
			return [];
		}
		return entries.map(entry => ({
			name: String(entry.name ?? ''),
			path: String(entry.path ?? ''),
			isDir: !!entry.is_dir,
			size: Number(entry.size ?? 0),
			modified: Number(entry.modified ?? 0)
		}));
	}

	async stat(path: string): Promise<SideXFileStat> {
		const stat = await invoke<{
			size: number;
			is_dir: boolean;
			is_file: boolean;
			is_symlink: boolean;
			modified: number;
			created: number;
			readonly: boolean;
		}>('stat', { path });
		return {
			size: Number(stat.size ?? 0),
			isDir: !!stat.is_dir,
			isFile: !!stat.is_file,
			isSymlink: !!stat.is_symlink,
			modified: Number(stat.modified ?? 0),
			created: Number(stat.created ?? 0),
			readOnly: !!stat.readonly
		};
	}

	async createFile(path: string, content = ''): Promise<void> {
		await invoke('write_file', { path, content });
	}

	async createFolder(path: string): Promise<void> {
		await invoke('mkdir', { path, recursive: true });
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		await invoke('rename', { oldPath, newPath });
	}

	async moveToTrash(path: string): Promise<void> {
		await invoke('move_to_trash', { path });
	}

	async copy(source: string, destination: string, recursive = true): Promise<void> {
		await invoke('copy_path', { source, dest: destination, recursive });
	}
}

registerSingleton(ISideXExplorerService, SideXExplorerService, InstantiationType.Delayed);
