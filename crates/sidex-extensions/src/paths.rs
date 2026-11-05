//! Standard filesystem paths for `SideX` extension storage.
//!
//! On Linux, follows the XDG Base Directory Specification:
//!   - Config: `$XDG_CONFIG_HOME/SideX` (default `~/.config/SideX`)
//!   - Data: `$XDG_DATA_HOME/SideX` (default `~/.local/share/SideX`)
//!
//! On macOS: `~/Library/Application Support/SideX`
//! On Windows: `%APPDATA%/SideX`

use std::path::PathBuf;

const APP_NAME: &str = "SideX";

/// Root `SideX` config directory following platform conventions.
///
/// - Linux: `$XDG_CONFIG_HOME/SideX` (default `~/.config/SideX`)
/// - macOS: `~/Library/Application Support/SideX`
/// - Windows: `%APPDATA%/SideX`
pub fn sidex_config_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".config")
            });
        base.join(APP_NAME)
    }

    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join(APP_NAME)
    }

    #[cfg(target_os = "windows")]
    {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(APP_NAME)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(APP_NAME)
    }
}

/// Root `SideX` data directory (backward-compatible alias).
///
/// Previously this was hard-coded to `~/.sidex`. Now it returns the
/// platform-appropriate config directory.
pub fn sidex_data_dir() -> PathBuf {
    sidex_config_dir()
}

/// User-installed extensions directory.
///
/// - Linux: `$XDG_DATA_HOME/SideX/extensions` (default `~/.local/share/SideX/extensions`)
/// - macOS: `~/Library/Application Support/SideX/extensions`
/// - Windows: `%APPDATA%/SideX/extensions`
pub fn user_extensions_dir() -> PathBuf {
    let dir = extensions_base_dir().join("extensions");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Global extension storage directory.
pub fn global_storage_dir() -> PathBuf {
    let dir = sidex_config_dir()
        .join("data")
        .join("User")
        .join("globalStorage");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// User data directory.
pub fn user_data_dir() -> PathBuf {
    sidex_config_dir().join("data")
}

/// Base directory for extensions on Linux uses XDG_DATA_HOME to keep large
/// extension binaries separate from config. On other platforms, uses the
/// same directory as config.
fn extensions_base_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".local")
                    .join("share")
            });
        base.join(APP_NAME)
    }

    #[cfg(not(target_os = "linux"))]
    {
        sidex_config_dir()
    }
}
