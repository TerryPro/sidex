use std::env;
use std::path::PathBuf;
use tauri::Manager;

const SENSITIVE_ENV_PATTERNS: &[&str] = &[
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "API_KEY",
    "APIKEY",
    "AUTH",
    "AWS_",
    "AZURE_",
    "GCP_",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "DOCKER_PASSWORD",
    "SSH_",
    "GPG_",
];

#[tauri::command]
pub fn get_all_env() -> std::collections::HashMap<String, String> {
    env::vars()
        .filter(|(key, _)| {
            let upper = key.to_uppercase();
            !SENSITIVE_ENV_PATTERNS.iter().any(|p| upper.contains(p))
        })
        .collect()
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn get_user_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let user_dir = resolve_user_data_dir(&app)?;
    std::fs::create_dir_all(&user_dir)
        .map_err(|e| format!("failed to create UserData dir: {e}"))?;
    Ok(user_dir.to_string_lossy().to_string())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn log_frontend_error(message: String) {
    log::error!("[frontend] {message}");
}

#[derive(serde::Serialize)]
pub struct ModifierKeys {
    pub control: bool,
    pub shift: bool,
}

/// 读取拖放时的修饰键状态；系统拖入事件本身不携带键盘信息。
#[tauri::command]
#[allow(unsafe_code)]
pub fn get_modifier_keys() -> ModifierKeys {
    #[cfg(windows)]
    {
        unsafe {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                GetAsyncKeyState, VK_CONTROL, VK_SHIFT,
            };
            let control = GetAsyncKeyState(VK_CONTROL as i32) < 0;
            let shift = GetAsyncKeyState(VK_SHIFT as i32) < 0;
            return ModifierKeys { control, shift };
        }
    }

    #[cfg(not(windows))]
    {
        ModifierKeys {
            control: false,
            shift: false,
        }
    }
}

pub(crate) fn resolve_user_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    if let Some(config_dir) = dirs::config_dir() {
        return Ok(config_dir.join("SideX").join("UserData"));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    Ok(dir.join("UserData"))
}
