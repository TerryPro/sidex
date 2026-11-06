use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use super::storage::StorageDb;

#[derive(Debug, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

const WINDOW_STATE_KEY: &str = "sidex.windowState";

/// 进程启动时刻，用于把「窗口真正可交互」的耗时打进日志。
pub struct BootTimer(pub std::time::Instant);

/// 前端在 workbench 完成首屏布局后调用，仅用于启动耗时诊断。
#[tauri::command]
pub fn frontend_ready(
    timer: tauri::State<'_, BootTimer>,
    render_ms: Option<f64>,
    load_ms: Option<f64>,
    start_ms: Option<f64>,
    diag: Option<String>,
) {
    log::info!(
        "[SideX] workbench ready in {}ms (module load {}, workbench init {})",
        timer.0.elapsed().as_millis(),
        opt_ms(load_ms),
        start_ms.zip(load_ms).map_or_else(
            || "?".to_string(),
            |(start, load)| format!("{:.0}ms", start - load)
        ),
    );
    if let Some(diag) = diag {
        log::info!("[SideX] boot breakdown: {diag}");
    }
    log::debug!("[SideX] frontend ready payload: render={render_ms:?}");
}

fn opt_ms(value: Option<f64>) -> String {
    value.map_or_else(|| "?".to_string(), |v| format!("{v:.0}ms"))
}

#[allow(clippy::cast_possible_wrap)]
pub fn restore_and_show(app: &tauri::App, db: &StorageDb) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Ok(Some(json)) = db.get(WINDOW_STATE_KEY) {
        if let Ok(state) = serde_json::from_str::<WindowState>(&json) {
            // Only restores position if it lands on an available monitor.
            let on_screen = app.available_monitors().ok().is_some_and(|monitors| {
                monitors.iter().any(|m| {
                    let pos = m.position();
                    let size = m.size();
                    let right = pos.x + size.width as i32;
                    let bottom = pos.y + size.height as i32;
                    // Require at least 100x50px of the window to be visible
                    state.x + 100 < right
                        && state.x + state.width as i32 > pos.x + 100
                        && state.y + 50 < bottom
                        && state.y > pos.y - 50
                })
            });

            if on_screen {
                let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
                let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
                if state.maximized {
                    let _ = window.maximize();
                }
            }
        }
    }

    let _ = window.show();
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn save_window_state(
    app: AppHandle,
    label: String,
    db: tauri::State<'_, Arc<StorageDb>>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window '{label}' not found"))?;

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let maximized = window.is_maximized().unwrap_or(false);

    let state = WindowState {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized,
    };

    let json = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    db.set(WINDOW_STATE_KEY, &json)?;
    Ok(())
}
