//! 后端命令面守卫：`generate_handler!` 里注册的每条命令，都必须在前端
//! （`src/**/*.{ts,js,html}` 与根 `index.html`）以字符串字面量形式出现。
//!
//! 这是一条单向约束：只防止「后端注册了但前端从未调用」的死命令回潮，
//! 不检查前端调用了但后端未注册的情况。

use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri 应当有上级目录")
        .to_path_buf()
}

/// 从 `lib.rs` 的 `generate_handler!` 列表里提取命令名。
///
/// 注册项形如 `commands::fs::read_file,`（模块限定），提取最后一段。
fn registered_commands(lib_rs: &str) -> Vec<String> {
    lib_rs
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let path = trimmed.strip_prefix("commands::")?.strip_suffix(',')?;
            path.rsplit("::").next().map(str::to_owned)
        })
        .collect()
}

fn has_literal(content: &str, name: &str) -> bool {
    content.contains(&format!("'{name}'"))
        || content.contains(&format!("\"{name}\""))
        || content.contains(&format!("`{name}`"))
}

/// 逐文件扫描，命中即从待查列表移除，避免把整个源码树读进内存。
fn scan_dir(dir: &Path, pending: &mut Vec<String>) {
    if pending.is_empty() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().and_then(|n| n.to_str()) == Some("node_modules") {
                continue;
            }
            scan_dir(&path, pending);
            if pending.is_empty() {
                return;
            }
        } else if matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("ts" | "js" | "html")
        ) {
            if let Ok(content) = fs::read_to_string(&path) {
                pending.retain(|name| !has_literal(&content, name));
            }
            if pending.is_empty() {
                return;
            }
        }
    }
}

#[test]
fn every_registered_command_is_referenced_by_frontend() {
    let root = repo_root();
    let lib_rs = fs::read_to_string(root.join("src-tauri/src/lib.rs"))
        .expect("读取 src-tauri/src/lib.rs 失败");
    let commands = registered_commands(&lib_rs);

    assert!(
        commands.len() > 50,
        "generate_handler! 解析异常，只找到 {} 条命令",
        commands.len()
    );

    let mut pending = commands;
    scan_dir(&root.join("src"), &mut pending);

    // 启动页在仓库根目录，不在 src 下。
    if let Ok(index) = fs::read_to_string(root.join("index.html")) {
        pending.retain(|name| !has_literal(&index, name));
    }

    pending.sort();
    assert!(
        pending.is_empty(),
        "以下命令已注册但前端没有任何引用，请删除：{pending:?}"
    );
}
