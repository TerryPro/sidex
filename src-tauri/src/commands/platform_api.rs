use serde::Serialize;
use std::env;

#[tauri::command]
pub fn clipboard_read_text() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
    clipboard
        .get_text()
        .map_err(|e| format!("clipboard read failed: {e}"))
}

#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("clipboard unavailable: {e}"))?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("clipboard write failed: {e}"))
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let parsed: url::Url = url.parse().map_err(|_| "invalid URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => {}
        s => return Err(format!("blocked scheme: {s}")),
    }
    open::that(parsed.as_str()).map_err(|e| format!("failed to open URL: {e}"))
}

#[tauri::command]
pub fn env_shell() -> String {
    env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            "/bin/sh".to_string()
        }
    })
}

#[derive(Serialize)]
pub struct AppHostInfo {
    pub os: String,
    pub arch: String,
}

#[tauri::command]
pub fn env_app_host() -> AppHostInfo {
    AppHostInfo {
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
    }
}
