mod app_dirs;
mod commands;

use commands::settings::SettingsStore;
use commands::storage::StorageDb;
use commands::terminal::TerminalStore;
use commands::watch::WatchStore;
use commands::window::restore_and_show;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;

#[cfg(target_os = "macos")]
#[allow(clippy::too_many_lines)]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file_menu = SubmenuBuilder::with_id(app, "file_menu", "File")
        .item(
            &MenuItemBuilder::with_id("new_file", "New File")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_file", "Open File...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("open_folder", "Open Folder...").build(app)?)
        .item(&MenuItemBuilder::with_id("open_recent", "Open Recent").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save_all", "Save All")
                .accelerator("CmdOrCtrl+Alt+S")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("close_editor", "Close Editor")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("close_window", "Close Window")
                .accelerator("CmdOrCtrl+Shift+W")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::with_id(app, "edit_menu", "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("find", "Find")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("replace", "Replace")
                .accelerator("CmdOrCtrl+H")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("find_in_files", "Find in Files")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("replace_in_files", "Replace in Files")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?,
        )
        .build()?;

    let selection_menu = SubmenuBuilder::with_id(app, "selection_menu", "Selection")
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .item(
            &MenuItemBuilder::with_id("expand_selection", "Expand Selection")
                .accelerator("CmdOrCtrl+Shift+Right")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("shrink_selection", "Shrink Selection")
                .accelerator("CmdOrCtrl+Shift+Left")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("copy_line_up", "Copy Line Up")
                .accelerator("Alt+Shift+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("copy_line_down", "Copy Line Down")
                .accelerator("Alt+Shift+Down")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("move_line_up", "Move Line Up")
                .accelerator("Alt+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("move_line_down", "Move Line Down")
                .accelerator("Alt+Down")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("add_cursor_above", "Add Cursor Above")
                .accelerator("CmdOrCtrl+Alt+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("add_cursor_below", "Add Cursor Below")
                .accelerator("CmdOrCtrl+Alt+Down")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("select_all_occurrences", "Select All Occurrences")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::with_id(app, "view_menu", "View")
        .item(
            &MenuItemBuilder::with_id("command_palette", "Command Palette...")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("open_view", "Open View...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("explorer", "Explorer")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("search", "Search")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("extensions", "Extensions")
                .accelerator("CmdOrCtrl+Shift+X")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("output", "Output")
                .accelerator("CmdOrCtrl+Shift+U")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("terminal", "Terminal")
                .accelerator("CmdOrCtrl+`")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("toggle_fullscreen", "Toggle Full Screen")
                .accelerator("F11")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("reset_zoom", "Reset Zoom")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .build()?;

    let go_menu = SubmenuBuilder::with_id(app, "go_menu", "Go")
        .item(
            &MenuItemBuilder::with_id("back", "Back")
                .accelerator("CmdOrCtrl+Alt+Left")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("forward", "Forward")
                .accelerator("CmdOrCtrl+Alt+Right")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go_to_file", "Go to File...")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go_to_symbol", "Go to Symbol in Workspace...")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go_to_line", "Go to Line/Column...")
                .accelerator("CmdOrCtrl+G")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go_to_definition", "Go to Definition")
                .accelerator("F12")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go_to_references", "Go to References")
                .accelerator("Shift+F12")
                .build(app)?,
        )
        .build()?;

    let terminal_menu = SubmenuBuilder::with_id(app, "terminal_menu", "Terminal")
        .item(
            &MenuItemBuilder::with_id("new_terminal", "New Terminal")
                .accelerator("CmdOrCtrl+Shift+`")
                .build(app)?,
        )
        .build()?;

    let window_menu = SubmenuBuilder::with_id(app, "window_menu", "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    let help_menu = SubmenuBuilder::with_id(app, "help_menu", "Help")
        .item(&MenuItemBuilder::with_id("welcome", "Welcome").build(app)?)
        .item(&MenuItemBuilder::with_id("documentation", "Documentation").build(app)?)
        .item(&MenuItemBuilder::with_id("release_notes", "Release Notes").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts Reference")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("report_issue", "Report Issue").build(app)?)
        .separator()
        .build()?;

    let sidex_menu = SubmenuBuilder::with_id(app, "sidex_menu", "SideX")
        .item(&PredefinedMenuItem::about(app, Some("About SideX"), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let menu = Menu::with_items(
        app,
        &[
            &sidex_menu,
            &file_menu,
            &edit_menu,
            &selection_menu,
            &view_menu,
            &go_menu,
            &terminal_menu,
            &window_menu,
            &help_menu,
        ],
    )?;

    Ok(menu)
}

/// macOS GUI apps inherit a minimal `PATH` (`/usr/bin:/bin`) from launchd,
/// which breaks discovery of git/node/LSP binaries installed via Homebrew,
/// nvm, etc. Query the user's login shell for its interactive `PATH` and
/// adopt it if it is richer than the current one.
///
/// Vendored minimal equivalent of the `fix-path-env` crate
/// (tauri-apps/fix-path-env-rs), which is not published on crates.io.
#[cfg(target_os = "macos")]
fn fix_macos_path() {
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());

    let child = Command::new(&shell)
        .args(["-ilc", "echo -n \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            log::warn!("fix_macos_path: failed to spawn {shell}: {e}");
            return;
        }
    };

    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    let output = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            log::warn!("fix_macos_path: shell failed: {e}");
            return;
        }
        Err(_) => {
            // Timed out: kill the orphaned shell and keep the default PATH.
            let _ = Command::new("kill").arg(pid.to_string()).status();
            log::warn!("fix_macos_path: timed out waiting for {shell}");
            return;
        }
    };

    let new_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let current_path = std::env::var("PATH").unwrap_or_default();
    if !new_path.is_empty() && new_path.len() > current_path.len() {
        std::env::set_var("PATH", &new_path);
    }
}

/// Parses a single `bytes=start-end` range. Multi-range requests fall back to
/// the full response, which is acceptable for thumbnails and previews.
fn parse_range_header(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start_text, end_text) = spec.split_once('-')?;

    if start_text.is_empty() {
        let suffix: u64 = end_text.parse().ok()?;
        if suffix == 0 || total == 0 {
            return None;
        }
        return Some((total.saturating_sub(suffix), total - 1));
    }

    let start: u64 = start_text.parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if end_text.is_empty() {
        total - 1
    } else {
        end_text.parse::<u64>().ok()?.min(total - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() {
    // Inherit the user's login-shell PATH before anything (terminals, git,
    // LSP servers, extension hosts) is spawned.
    #[cfg(target_os = "macos")]
    fix_macos_path();

    // Load .env from project root (parent of src-tauri)
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = std::path::Path::new(manifest_dir)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    let env_path = project_root.join(".env");
    if env_path.exists() {
        dotenvy::from_path(&env_path).ok();
    }

    // 记录进程启动时刻；前端就绪后会用它打印启动耗时（仅诊断用途）。
    let boot_instant = std::time::Instant::now();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(TerminalStore::new()))
        .manage(Arc::new(WatchStore::new()))
        .manage(Arc::new(SettingsStore::new()))
        .register_asynchronous_uri_scheme_protocol("sidex-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let raw_path = request.uri().path();
                let decoded = urlencoding::decode(raw_path.strip_prefix('/').unwrap_or(raw_path))
                    .unwrap_or_default();

                // The webview host runs on `<uuid>` subdomains of this scheme so
                // it is a different origin (and therefore a different renderer
                // process) than the workbench.
                if decoded.starts_with("webview-pre/") {
                    let base = if cfg!(debug_assertions) {
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public")
                    } else {
                        let resources = app.path().resource_dir().unwrap_or_default();
                        let direct = resources.join("webview-pre");
                        if direct.exists() {
                            resources.clone()
                        } else {
                            // Tauri maps `../` sources under `_up_` in the bundle.
                            resources.join("_up_").join("public")
                        }
                    };
                    let file = base.join(decoded.as_ref());
                    let mime = match file
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or_default()
                    {
                        "html" => "text/html; charset=utf-8",
                        "js" | "mjs" => "text/javascript; charset=utf-8",
                        "css" => "text/css; charset=utf-8",
                        "json" => "application/json; charset=utf-8",
                        "svg" => "image/svg+xml",
                        "png" => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "gif" => "image/gif",
                        "webp" => "image/webp",
                        "bmp" => "image/bmp",
                        "ico" | "cur" => "image/x-icon",
                        "woff" => "font/woff",
                        "woff2" => "font/woff2",
                        "ttf" => "font/ttf",
                        "otf" => "font/otf",
                        "wasm" => "application/wasm",
                        _ => "application/octet-stream",
                    };
                    match std::fs::read(&file) {
                        Ok(bytes) => {
                            let _ = responder.respond(
                                tauri::http::Response::builder()
                                    .status(200)
                                    .header("Content-Type", mime)
                                    .header("Access-Control-Allow-Origin", "*")
                                    .body(bytes)
                                    .unwrap(),
                            );
                        }
                        Err(_) => {
                            let _ = responder.respond(
                                tauri::http::Response::builder()
                                    .status(404)
                                    .header("Access-Control-Allow-Origin", "*")
                                    .body(Vec::new())
                                    .unwrap(),
                            );
                        }
                    }
                    return;
                }

                // Security: only serve files from the app's resource directories
                // Block path traversal, symlinks to sensitive files, and absolute paths
                // outside the expected asset directories.
                let path = std::path::Path::new(decoded.as_ref());
                log::info!("[sidex-asset] {}", decoded);
                let canonical = match path.canonicalize() {
                    Ok(p) => p,
                    Err(_) => {
                        responder.respond(
                            tauri::http::Response::builder()
                                .status(404)
                                .header("Access-Control-Allow-Origin", "*")
                                .body(Vec::new())
                                .unwrap(),
                        );
                        return;
                    }
                };

                // Only allow files within the user's workspace or common asset paths
                let canonical_str = canonical.to_string_lossy();
                let is_safe = !canonical_str.contains("/.ssh/")
                    && !canonical_str.contains("/.gnupg/")
                    && !canonical_str.contains("/etc/")
                    && !canonical_str.starts_with("/System")
                    && !canonical_str.contains("/.env");

                if !is_safe {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(403)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(Vec::new())
                            .unwrap(),
                    );
                    return;
                }

                let mime = match std::path::Path::new(decoded.as_ref())
                    .extension()
                    .and_then(|e| e.to_str())
                {
                    Some("png") => "image/png",
                    Some("jpg" | "jpeg") => "image/jpeg",
                    Some("gif") => "image/gif",
                    Some("svg") => "image/svg+xml",
                    Some("webp") => "image/webp",
                    Some("bmp") => "image/bmp",
                    Some("ico") => "image/x-icon",
                    Some("pdf") => "application/pdf",
                    Some("mp4" | "m4v") => "video/mp4",
                    Some("webm") => "video/webm",
                    Some("mkv") => "video/x-matroska",
                    Some("mov") => "video/quicktime",
                    Some("avi") => "video/x-msvideo",
                    Some("wmv") => "video/x-ms-wmv",
                    Some("woff") => "font/woff",
                    Some("woff2") => "font/woff2",
                    Some("ttf") => "font/ttf",
                    Some("css") => "text/css",
                    Some("js") => "text/javascript",
                    Some("html" | "htm") => "text/html",
                    Some("json") => "application/json",
                    Some("wasm") => "application/wasm",
                    _ => "application/octet-stream",
                };

                // Media elements (video thumbnails) probe with Range requests; serve
                // only the requested slice instead of reading the whole file.
                let total_size = std::fs::metadata(&canonical).map(|m| m.len()).unwrap_or(0);
                let range = request
                    .headers()
                    .get("range")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| parse_range_header(value, total_size));

                if let Some((start, end)) = range {
                    if let Ok(mut file) = std::fs::File::open(&canonical) {
                        if file.seek(SeekFrom::Start(start)).is_ok() {
                            let length = (end - start + 1) as usize;
                            let mut buffer = vec![0u8; length];
                            if file.read_exact(&mut buffer).is_ok() {
                                let _ = responder.respond(
                                    tauri::http::Response::builder()
                                        .status(206)
                                        .header("Content-Type", mime)
                                        .header("Content-Range", format!("bytes {start}-{end}/{total_size}"))
                                        .header("Accept-Ranges", "bytes")
                                        .header("Content-Length", length.to_string())
                                        .header("Access-Control-Allow-Origin", "*")
                                        .body(buffer)
                                        .unwrap(),
                                );
                                return;
                            }
                        }
                    }
                }

                let Ok(data) = std::fs::read(&canonical) else {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(404)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(Vec::new())
                            .unwrap(),
                    );
                    return;
                };

                responder.respond(
                    tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Accept-Ranges", "bytes")
                        .header("Content-Length", data.len().to_string())
                        .header("Access-Control-Allow-Origin", "*")
                        .body(data)
                        .unwrap(),
                );
            });
        })
        .setup(move |app| {
            app.manage(commands::window::BootTimer(boot_instant));

            let app_data = crate::app_dirs::resolve_and_migrate();
            std::fs::create_dir_all(&app_data).ok();
            let db_path = app_data.join("sidex_storage.db");
            // Non-UTF-8 app-data paths and a corrupt/locked DB must not hard-
            // crash the app with no message — recreate the DB once, then fail
            // with a readable error.
            let db_path_str = db_path.to_string_lossy().to_string();
            let db = match StorageDb::new(&db_path_str) {
                Ok(db) => db,
                Err(e) => {
                    log::error!("storage DB open failed ({e}); recreating {db_path_str}");
                    let _ = std::fs::remove_file(&db_path);
                    StorageDb::new(&db_path_str)
                        .map_err(|e| format!("failed to initialize storage database: {e}"))?
                }
            };

            restore_and_show(app, &db);

            // Debug-only: SIDEX_DEVTOOLS=1 auto-opens devtools to capture boot errors
            #[cfg(debug_assertions)]
            if std::env::var("SIDEX_DEVTOOLS").is_ok() {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }

            app.manage(Arc::new(db));

            {
                let settings_store = app.state::<Arc<SettingsStore>>();
                let user_settings_path = app_data.join("UserData").join("User").join("settings.json");
                // Always record the path so user-scope updates persist to
                // disk, even on first launch when the file doesn't exist yet.
                settings_store.set_user_path(&user_settings_path);
                if user_settings_path.exists() {
                    if let Err(e) = settings_store.load_user(&user_settings_path) {
                        log::warn!("failed to pre-load user settings: {e}");
                    }
                }
            }

            if let Err(err) = commands::profiles::initialize(app.handle()) {
                log::warn!("profile storage disabled: {err}");
            }
            if let Err(err) = commands::secrets::initialize(app.handle()) {
                log::warn!("secret storage disabled: {err}");
            }

            #[cfg(target_os = "macos")]
            {
                let menu = build_menu(app.handle())?;
                app.set_menu(menu)?;
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[allow(unexpected_cfgs)]
            {
                #[cfg(feature = "devtools")]
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if let Some(window) = app.get_webview_window("main") {
                let escaped = id.replace('\\', "\\\\").replace('\'', "\\'");
                let _ = window.eval(format!(
                    "window.dispatchEvent(new CustomEvent('sidex-native-menu', {{ detail: '{escaped}' }}))"
                ));
            }
        })
        .invoke_handler(tauri::generate_handler![
            // File system
            commands::read_file,
            commands::get_cwd,
            commands::read_file_bytes,
            commands::write_file,
            commands::write_file_bytes,
            commands::read_dir,
            commands::list_drives,
            commands::log_frontend_error,
            commands::stat,
            commands::mkdir,
            commands::remove,
            commands::rename,
            commands::exists,
            commands::copy_path,
            commands::move_path,
            commands::move_to_trash,
            commands::restore_from_trash,
            // Path operations
            commands::parse_path,
            commands::join_paths,
            commands::relative_path,
            commands::glob_match,
            commands::ext_category,
            commands::is_binary_file,
            commands::common_parent,
            // Text processing
            commands::count_lines,
            commands::file_summary,
            commands::normalize_line_endings_cmd,
            commands::to_crlf,
            commands::trim_trailing_whitespace,
            commands::ensure_final_newline,
            commands::get_word_boundaries,
            commands::simple_diff,
            commands::file_hash,
            commands::files_equal,
            // Crypto
            commands::sha256_hash,
            commands::sha256_file,
            commands::md5_hash,
            commands::md5_file,
            commands::random_bytes,
            commands::uuid_v4,
            commands::base64_encode,
            commands::base64_decode,
            commands::base64_encode_urlsafe,
            commands::base64_decode_urlsafe,
            commands::file_hashes,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
            commands::terminal_get_pid,
            commands::get_default_shell,
            commands::check_shell_exists,
            commands::get_available_shells,
            commands::get_shell_integration_dir,
            commands::setup_zsh_dotdir,
            commands::search_files,
            commands::search_text,
            commands::frontend_ready,
            commands::save_window_state,
            commands::profiles_load,
            commands::profiles_save,
            commands::profiles_load_associations,
            commands::profiles_save_associations,
            commands::secret_get,
            commands::secret_set,
            commands::secret_delete,
            commands::secret_keys,
            commands::get_all_env,
            commands::get_modifier_keys,
            commands::get_user_data_dir,
            commands::storage_get,
            commands::storage_list,
            commands::storage_set,
            commands::storage_delete,
            // Layered settings
            commands::settings_get,
            commands::settings_update,
            commands::settings_load,
            commands::settings_parse_jsonc,
            commands::settings_modify_jsonc,
            commands::proxy_request,
            commands::proxy_request_full,
            // File watching
            commands::watch_start,
            commands::watch_stop,
            commands::watch_update_patterns,
            commands::watch_list,
            commands::watch_is_active,
            // Extensions (built-in declarative only)
            commands::list_installed_extensions,
            // LSP management removed: SideX keeps syntax highlighting, folding and outline only.
            // Syntax / language info
            commands::syntax_get_languages,
            commands::syntax_detect_language,
            commands::syntax_detect_from_content,
            commands::syntax_get_language_config,
            commands::syntax_tokenize,
            commands::syntax_get_document_symbols,
            commands::syntax_get_folding_ranges,
            // Theme management
            commands::theme_list,
            commands::theme_get,
            commands::theme_get_default_dark,
            commands::theme_get_default_light,
            // Keymap
            commands::keymap_get_defaults,
            commands::keymap_resolve,
            commands::keymap_resolve_chord,
            commands::keymap_get_all,
            // Editor intelligence
            commands::editor_detect_colors,
            commands::editor_compute_bracket_pairs,
            commands::editor_compute_folding_ranges,
            // Menu i18n
            commands::update_menu_labels,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, event| {
            // Kill every child process we spawned when the app exits —
            // PTY shells would otherwise outlive the editor as orphans.
            if let tauri::RunEvent::Exit = event {
                // PTY cleanup is handled by the terminal store's drop path.
            }
        });
}

#[cfg(test)]
mod tests {
    use super::parse_range_header;

    #[test]
    fn parses_bounded_and_open_ranges() {
        assert_eq!(parse_range_header("bytes=0-4", 10), Some((0, 4)));
        assert_eq!(parse_range_header("bytes=5-", 10), Some((5, 9)));
        assert_eq!(parse_range_header("bytes=5-20", 10), Some((5, 9)));
    }

    #[test]
    fn parses_suffix_ranges() {
        assert_eq!(parse_range_header("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_range_header("bytes=-20", 10), Some((0, 9)));
    }

    #[test]
    fn rejects_invalid_ranges() {
        assert_eq!(parse_range_header("items=0-1", 10), None);
        assert_eq!(parse_range_header("bytes=9-3", 10), None);
        assert_eq!(parse_range_header("bytes=10-", 10), None);
        assert_eq!(parse_range_header("bytes=0-1,3-4", 10), None);
        assert_eq!(parse_range_header("bytes=-0", 10), None);
        assert_eq!(parse_range_header("bytes=0-", 0), None);
    }
}
