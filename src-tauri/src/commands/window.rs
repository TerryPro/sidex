use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use super::storage::StorageDb;

#[derive(Debug, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// Window bounds to return to when un-maximizing a window that SideX
/// maximized itself (see [`toggle_window_maximize`]).
#[derive(Clone, Copy, Debug)]
pub struct NormalBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct WindowMaximizeState(Mutex<Option<NormalBounds>>);

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

/// Work area of the monitor containing the given physical point.
fn monitor_work_area_at(
    app: &tauri::AppHandle,
    x: i32,
    y: i32,
) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let monitors = app.available_monitors().ok()?;
    monitors
        .into_iter()
        .find(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            x >= pos.x && x < pos.x + size.width as i32 && y >= pos.y && y < pos.y + size.height as i32
        })
        .map(|monitor| (monitor.work_area().position, monitor.work_area().size))
}

/// True when the window's client area exactly covers the work area of its
/// monitor.
///
/// Borderless windows are maximized by filling the work area with the client
/// area instead of calling the OS maximize: the native maximize includes the
/// (invisible) resize border and leaves the client a few pixels larger than the
/// screen, clipping the UI at the top edge.
fn fills_work_area(window: &tauri::WebviewWindow) -> bool {
    let Ok(monitor) = window.current_monitor() else {
        return false;
    };
    let Some(monitor) = monitor else {
        return false;
    };
    let work = monitor.work_area();
    let (Ok(pos), Ok(size)) = (window.inner_position(), window.inner_size()) else {
        return false;
    };
    (pos.x - work.position.x).abs() <= 2
        && (pos.y - work.position.y).abs() <= 2
        && size.width.abs_diff(work.size.width) <= 2
        && size.height.abs_diff(work.size.height) <= 2
}

/// Offset of the client area inside the window (the invisible resize border).
fn client_inset(window: &tauri::WebviewWindow) -> Result<PhysicalPosition<i32>, String> {
    let outer = window.outer_position().map_err(|e| e.to_string())?;
    let inner = window.inner_position().map_err(|e| e.to_string())?;
    Ok(PhysicalPosition::new(inner.x - outer.x, inner.y - outer.y))
}

/// Cover the monitor work area with the client area. The (invisible) border
/// extends past the monitor edges, which is harmless and avoids any gap.
fn fill_work_area(
    window: &tauri::WebviewWindow,
    work_pos: PhysicalPosition<i32>,
    work_size: PhysicalSize<u32>,
) -> Result<(), String> {
    let inset = client_inset(window)?;
    window
        .set_position(PhysicalPosition::new(work_pos.x - inset.x, work_pos.y - inset.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(work_size.width, work_size.height))
        .map_err(|e| e.to_string())
}

/// Resize the window so that its *outer* size matches `size`.
///
/// Tauri's `set_size` changes the client (inner) size, so the invisible
/// resize border has to be subtracted to avoid overflowing the monitor.
fn set_outer_size(window: &tauri::WebviewWindow, size: PhysicalSize<u32>) -> Result<(), String> {
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let frame_width = outer.width.saturating_sub(inner.width);
    let frame_height = outer.height.saturating_sub(inner.height);
    window
        .set_size(PhysicalSize::new(
            size.width.saturating_sub(frame_width),
            size.height.saturating_sub(frame_height),
        ))
        .map_err(|e| e.to_string())
}

#[allow(clippy::needless_pass_by_value)]
fn window_by_label(app: &AppHandle, label: &str) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window '{label}' not found"))
}

/// Ask DWM for the system rounded corners.
///
/// Windows 11 only rounds windows that have a native frame, so a borderless
/// window (`decorations: false`) stays square unless the preference is set.
/// Maximized windows are still drawn square by the OS.
pub fn apply_rounded_corners(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        #[allow(unsafe_code)]
        unsafe {
            use windows_sys::Win32::Graphics::Dwm::{
                DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
            };
            let Ok(hwnd) = window.hwnd() else {
                return;
            };
            let preference: i32 = DWMWCP_ROUND;
            // Fails harmlessly on Windows 10, which has no rounded corner API.
            let _ = DwmSetWindowAttribute(
                hwnd.0 as isize,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                std::ptr::from_ref(&preference).cast(),
                std::mem::size_of_val(&preference) as u32,
            );
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

fn apply_normal_bounds(window: &tauri::WebviewWindow, bounds: NormalBounds) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    set_outer_size(window, PhysicalSize::new(bounds.width, bounds.height))
}

/// Restore to `bounds`, correcting the position a second time.
///
/// Windows re-applies the rect it remembered before the maximize right after
/// `unmaximize()`, which overwrites the bounds set here and can push the
/// window off screen. Re-applying from the main thread once the event loop has
/// settled wins that race.
fn restore_normal_bounds(app: &AppHandle, window: &tauri::WebviewWindow, bounds: NormalBounds) {
    let _ = apply_normal_bounds(window, bounds);

    let app = app.clone();
    let window = window.clone();
    let _ = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(160));
        let _ = app.run_on_main_thread(move || {
            let matches = match (window.outer_position(), window.outer_size()) {
                (Ok(pos), Ok(size)) => {
                    (pos.x - bounds.x).abs() <= 2
                        && (pos.y - bounds.y).abs() <= 2
                        && size.width.abs_diff(bounds.width) <= 2
                        && size.height.abs_diff(bounds.height) <= 2
                }
                _ => false,
            };
            if !matches {
                log::info!(
                    "[SideX] re-applying window bounds after un-maximize: {:?}",
                    (window.outer_position(), window.outer_size())
                );
                let _ = apply_normal_bounds(&window, bounds);
            }
        });
    });
}

/// A sensible size to restore to when nothing better is known: two thirds of
/// the work area, centered.
fn default_normal_bounds(app: &AppHandle, window: &tauri::WebviewWindow) -> Option<NormalBounds> {
    let pos = window.outer_position().ok()?;
    let (work_pos, work_size) = monitor_work_area_at(app, pos.x, pos.y)
        .or_else(|| monitor_work_area_at(app, 0, 0))?;
    let width = work_size.width * 2 / 3;
    let height = work_size.height * 2 / 3;
    Some(NormalBounds {
        x: work_pos.x + ((work_size.width - width) / 2) as i32,
        y: work_pos.y + ((work_size.height - height) / 2) as i32,
        width,
        height,
    })
}

/// Toggle maximize for a borderless window without overshooting the monitor.
#[tauri::command]
pub fn toggle_window_maximize(
    app: AppHandle,
    label: String,
    state: tauri::State<'_, WindowMaximizeState>,
) -> Result<bool, String> {
    let window = window_by_label(&app, &label)?;
    let mut saved = state.0.lock().map_err(|e| e.to_string())?;

    // Restore: either SideX sized the window to the work area, or the OS
    // maximized it (snap, Win+Up, window menu).
    if fills_work_area(&window) || window.is_maximized().unwrap_or(false) {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        }
        let pos = window
            .outer_position()
            .unwrap_or(PhysicalPosition::new(0, 0));
        let work = monitor_work_area_at(&app, pos.x, pos.y)
            .or_else(|| monitor_work_area_at(&app, 0, 0));
        // A "normal" size that covers the work area is not a real window size
        // (older builds persisted the maximized geometry); fall back to 2/3.
        let bounds = saved.take().filter(|bounds| {
            work.is_some_and(|(_, work_size)| {
                bounds.width < work_size.width || bounds.height < work_size.height
            })
        });
        if let Some(bounds) = bounds.or_else(|| default_normal_bounds(&app, &window)) {
            restore_normal_bounds(&app, &window, bounds);
        }
        return Ok(false);
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let Some((work_pos, work_size)) = monitor_work_area_at(&app, pos.x, pos.y)
        .or_else(|| monitor_work_area_at(&app, 0, 0))
    else {
        return Err("no monitor available".to_string());
    };

    *saved = Some(NormalBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    });

    fill_work_area(&window, work_pos, work_size)?;
    Ok(true)
}

/// Whether the window currently occupies the whole work area.
#[tauri::command]
pub fn is_window_maximized(app: AppHandle, label: String) -> Result<bool, String> {
    let window = window_by_label(&app, &label)?;
    Ok(window.is_maximized().unwrap_or(false) || fills_work_area(&window))
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
                // Clamp to the work area so a state saved on a larger monitor
                // (or a maximized-with-border size) can never exceed the screen.
                let work = monitor_work_area_at(
                    app.handle(),
                    state.x + state.width as i32 / 2,
                    state.y + state.height as i32 / 2,
                )
                .or_else(|| {
                    app.primary_monitor()
                        .ok()
                        .flatten()
                        .map(|monitor| (monitor.work_area().position, monitor.work_area().size))
                });
                let (x, y, width, height) = match work {
                    Some((work_pos, work_size)) => {
                        let width = state.width.min(work_size.width);
                        let height = state.height.min(work_size.height);
                        let x = state.x.clamp(
                            work_pos.x,
                            work_pos.x + work_size.width as i32 - width as i32,
                        );
                        let y = state.y.clamp(
                            work_pos.y,
                            work_pos.y + work_size.height as i32 - height as i32,
                        );
                        (x, y, width, height)
                    }
                    None => (state.x, state.y, state.width, state.height),
                };

                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                let _ = set_outer_size(&window, PhysicalSize::new(width, height));

                // A persisted "normal" size that covers the work area would leave
                // the transparent resize border inside the screen, so treat it as
                // maximized (the border then hangs off screen, as it should).
                let covers_work_area = work.is_some_and(|(_, work_size)| {
                    width >= work_size.width && height >= work_size.height
                });

                if state.maximized || covers_work_area {
                    if let Some((work_pos, work_size)) = work {
                        let _ = fill_work_area(&window, work_pos, work_size);

                        // Remember a sane size for the next "restore" click.
                        // Older versions persisted the maximized (border-inflated)
                        // size as the normal size, so ignore that case.
                        let normal = if state.width >= work_size.width || state.height >= work_size.height {
                            let width = work_size.width * 2 / 3;
                            let height = work_size.height * 2 / 3;
                            NormalBounds {
                                x: work_pos.x + ((work_size.width - width) / 2) as i32,
                                y: work_pos.y + ((work_size.height - height) / 2) as i32,
                                width,
                                height,
                            }
                        } else {
                            NormalBounds { x, y, width, height }
                        };
                        if let Ok(mut saved) = app.state::<WindowMaximizeState>().0.lock() {
                            *saved = Some(normal);
                        }
                    }
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
    maximize: tauri::State<'_, WindowMaximizeState>,
) -> Result<(), String> {
    let window = window_by_label(&app, &label)?;

    // While maximized, keep the last *normal* bounds so restoring the window
    // later returns it to a sane size instead of the full work area.
    let maximized = window.is_maximized().unwrap_or(false) || fills_work_area(&window);
    let stored_normal = db
        .get(WINDOW_STATE_KEY)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str::<WindowState>(&json).ok())
        .map(|state| NormalBounds {
            x: state.x,
            y: state.y,
            width: state.width,
            height: state.height,
        });

    let state = if maximized {
        if let Some(bounds) = maximize.0.lock().ok().and_then(|saved| *saved).or(stored_normal) {
            WindowState {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                maximized: true,
            }
        } else {
            let pos = window.outer_position().map_err(|e| e.to_string())?;
            let size = window.outer_size().map_err(|e| e.to_string())?;
            WindowState {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                maximized: true,
            }
        }
    } else {
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        WindowState {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
            maximized: false,
        }
    };

    let json = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    db.set(WINDOW_STATE_KEY, &json)?;
    Ok(())
}
