use serde::Serialize;
use std::path::Path;

use sidex_workspace::file_ops as ws;

use super::validation::validate_path;

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub path: String,
    pub letter: String,
    pub label: String,
    pub kind: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Debug, Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct FileStat {
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub modified: u64,
    pub created: u64,
    pub readonly: bool,
}

fn io_err(path: &str, e: &sidex_workspace::WorkspaceError) -> String {
    format!("{path}: {e}")
}

/// 单次 IPC 读取上限。超过此大小直接拒绝：整文件读入内存再跨 IPC 传输，
/// 大文件（几百 MB 的压缩包等）会把进程内存打爆并卡住主线程。
const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;

fn ensure_readable_size(path: &str) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("{path}: {e}"))?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "文件过大（{:.1} MB），超过单次读取上限 {} MB",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_READ_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    validate_path(&path)?;
    ensure_readable_size(&path)?;
    ws::read_file(Path::new(&path)).map_err(|e| io_err(&path, &e))
}

/// 返回原始字节（`tauri::ipc::Response`），避免把每个字节展开成 JSON 数字。
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    validate_path(&path)?;
    ensure_readable_size(&path)?;
    let bytes = ws::read_file_bytes(Path::new(&path)).map_err(|e| io_err(&path, &e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    validate_path(&path)?;
    ws::write_file(Path::new(&path), &content).map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn write_file_bytes(path: String, content: Vec<u8>) -> Result<(), String> {
    validate_path(&path)?;
    ws::write_file_bytes(Path::new(&path), &content).map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    validate_path(&path)?;
    let entries = ws::read_dir(Path::new(&path)).map_err(|e| io_err(&path, &e))?;

    Ok(entries
        .into_iter()
        .map(|e| DirEntry {
            name: e.name,
            path: e.path,
            is_dir: e.is_dir,
            is_file: e.is_file,
            is_symlink: e.is_symlink,
            size: e.size,
            modified: e.modified,
        })
        .collect())
}

#[tauri::command]
pub fn list_drives() -> Result<Vec<DriveInfo>, String> {
    #[cfg(windows)]
    {
        windows_drives::collect()
    }

    #[cfg(not(windows))]
    {
        Ok(vec![DriveInfo {
            path: "/".to_string(),
            letter: "/".to_string(),
            label: String::new(),
            kind: "fixed".to_string(),
            total_bytes: 0,
            free_bytes: 0,
        }])
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod windows_drives {
    use super::DriveInfo;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };
    use windows_sys::Win32::System::WindowsProgramming::{
        DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
    };

    fn wide(path: &str) -> Vec<u16> {
        OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn read_buffer(buffer: &[u16]) -> String {
        let length = buffer
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..length]).trim().to_string()
    }

    pub(super) fn collect() -> Result<Vec<DriveInfo>, String> {
        let mask = unsafe { GetLogicalDrives() };
        if mask == 0 {
            return Err("无法读取驱动器列表".to_string());
        }

        let mut drives = Vec::new();
        for index in 0..26u32 {
            if mask & (1u32 << index) == 0 {
                continue;
            }

            let letter = char::from(b'A' + index as u8).to_string();
            let path = format!("{letter}:\\");
            let root = wide(&path);

            let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
            let kind = match drive_type {
                DRIVE_REMOVABLE => "removable",
                DRIVE_FIXED => "fixed",
                DRIVE_REMOTE => "network",
                DRIVE_CDROM => "cdrom",
                DRIVE_RAMDISK => "ramdisk",
                _ => "unknown",
            }
            .to_string();

            let mut free_to_caller = 0u64;
            let mut total = 0u64;
            let mut total_free = 0u64;
            let has_space = unsafe {
                GetDiskFreeSpaceExW(
                    root.as_ptr(),
                    &mut free_to_caller,
                    &mut total,
                    &mut total_free,
                )
            } != 0;

            let mut label_buffer = [0u16; 256];
            let mut filesystem_buffer = [0u16; 64];
            let mut serial = 0u32;
            let mut max_component = 0u32;
            let mut flags = 0u32;
            let has_volume = unsafe {
                GetVolumeInformationW(
                    root.as_ptr(),
                    label_buffer.as_mut_ptr(),
                    label_buffer.len() as u32,
                    &mut serial,
                    &mut max_component,
                    &mut flags,
                    filesystem_buffer.as_mut_ptr(),
                    filesystem_buffer.len() as u32,
                )
            } != 0;

            if !has_space && kind == "cdrom" {
                // 空光驱在资源管理器里通常不展示容量信息，保留条目但跳过。
                continue;
            }

            drives.push(DriveInfo {
                path,
                letter: format!("{letter}:"),
                label: if has_volume {
                    read_buffer(&label_buffer)
                } else {
                    String::new()
                },
                kind,
                total_bytes: if has_space { total } else { 0 },
                free_bytes: if has_space { free_to_caller } else { 0 },
            });
        }

        Ok(drives)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn stat(path: String) -> Result<FileStat, String> {
    validate_path(&path)?;
    let s = ws::stat(Path::new(&path)).map_err(|e| io_err(&path, &e))?;
    Ok(FileStat {
        size: s.size,
        is_dir: s.is_dir,
        is_file: s.is_file,
        is_symlink: s.is_symlink,
        modified: s.modified,
        created: s.created,
        readonly: s.readonly,
    })
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn mkdir(path: String, recursive: bool) -> Result<(), String> {
    validate_path(&path)?;
    ws::mkdir(Path::new(&path), recursive).map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn remove(path: String, recursive: bool) -> Result<(), String> {
    validate_path(&path)?;
    ws::remove(Path::new(&path), recursive).map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn rename(old_path: String, new_path: String) -> Result<(), String> {
    validate_path(&old_path)?;
    validate_path(&new_path)?;
    ws::rename(Path::new(&old_path), Path::new(&new_path))
        .map_err(|e| format!("{old_path} -> {new_path}: {e}"))
}

#[allow(clippy::needless_pass_by_value, clippy::unnecessary_wraps)]
#[tauri::command]
pub fn exists(path: String) -> Result<bool, String> {
    validate_path(&path)?;
    Ok(ws::exists(Path::new(&path)))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn copy_path(source: String, dest: String, recursive: bool) -> Result<(), String> {
    validate_path(&source)?;
    validate_path(&dest)?;
    let src = Path::new(&source);
    let dst = Path::new(&dest);
    let existed = dst.exists();
    let result = if src.is_dir() {
        if !recursive {
            return Err("复制文件夹需要 recursive=true".to_string());
        }
        copy_dir_recursive(src, dst).map_err(|e| format!("{source}: {e}"))
    } else {
        std::fs::copy(src, dst)
            .map(|_| ())
            .map_err(|e| format!("{source}: {e}"))
    };
    // 复制失败时清掉本次新建的不完整目标，避免留下半完成状态。
    if result.is_err() && !existed {
        if dst.is_dir() {
            let _ = std::fs::remove_dir_all(dst);
        } else {
            let _ = std::fs::remove_file(dst);
        }
    }
    result
}

/// 把条目移到回收站，并尽量返回回收站条目 id，供撤销时精确恢复。
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn move_to_trash(path: String) -> Result<Option<String>, String> {
    validate_path(&path)?;
    trash::delete(&path).map_err(|e| format!("move to trash: {e}"))?;
    Ok(find_trash_item_id(&path))
}

#[cfg(windows)]
fn find_trash_item_id(path: &str) -> Option<String> {
    let source = Path::new(path);
    let parent = source.parent()?;
    let name = source.file_name()?;
    let items = trash::os_limited::list().ok()?;
    items
        .into_iter()
        .filter(|item| item.name == name && item.original_parent == parent)
        .max_by_key(|item| item.time_deleted)
        .map(|item| item.id.to_string_lossy().to_string())
}

#[cfg(not(windows))]
fn find_trash_item_id(_path: &str) -> Option<String> {
    None
}

/// 从回收站恢复条目；优先按 id 精确匹配，找不到时按原始路径回退。
#[tauri::command]
pub fn restore_from_trash(id: Option<String>, path: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let items = trash::os_limited::list().map_err(|e| format!("read trash: {e}"))?;
        let mut matched: Vec<_> = match &id {
            Some(target) => items
                .iter()
                .filter(|item| item.id.to_string_lossy() == *target)
                .cloned()
                .collect(),
            None => Vec::new(),
        };
        if matched.is_empty() {
            if let Some(target) = &path {
                matched = items
                    .into_iter()
                    .filter(|item| item.original_path().to_string_lossy() == *target)
                    .collect();
            }
        }
        if matched.is_empty() {
            return Err("回收站中找不到该项目，可能已被清空".to_string());
        }
        trash::os_limited::restore_all(matched).map_err(|e| format!("restore from trash: {e}"))
    }

    #[cfg(not(windows))]
    {
        let _ = (id, path);
        Err("当前平台不支持从回收站恢复".to_string())
    }
}

/// 移动文件或目录；跨盘时回退为「复制后删除」。
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn move_path(source: String, dest: String) -> Result<(), String> {
    validate_path(&source)?;
    validate_path(&dest)?;
    let src = Path::new(&source);
    let dst = Path::new(&dest);
    let existed = dst.exists();
    let result = if src.is_dir() {
        if std::fs::rename(src, dst).is_ok() {
            return Ok(());
        }
        copy_dir_recursive(src, dst)
            .and_then(|()| std::fs::remove_dir_all(src))
            .map_err(|e| format!("{source} -> {dest}: {e}"))
    } else {
        if std::fs::rename(src, dst).is_ok() {
            return Ok(());
        }
        std::fs::copy(src, dst)
            .and_then(|_| std::fs::remove_file(src))
            .map(|_| ())
            .map_err(|e| format!("{source} -> {dest}: {e}"))
    };
    // 跨盘回退失败时清掉新建的不完整目标；源文件保持不变。
    if result.is_err() && !existed {
        if dst.is_dir() {
            let _ = std::fs::remove_dir_all(dst);
        } else {
            let _ = std::fs::remove_file(dst);
        }
    }
    result
}
