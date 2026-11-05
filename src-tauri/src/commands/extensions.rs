use crate::commands::extension_platform::{read_extension_manifest, ExtensionManifest};
use serde::Serialize;
use sidex_extensions::paths::user_extensions_dir;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
pub struct InstalledExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub path: String,
}

fn to_installed(manifest: &ExtensionManifest, path: &std::path::Path) -> InstalledExtension {
    InstalledExtension {
        id: manifest.id.clone(),
        name: if manifest.display_name.is_empty() {
            manifest.name.clone()
        } else {
            manifest.display_name.clone()
        },
        version: manifest.version.clone(),
        path: path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub async fn list_installed_extensions(app: AppHandle) -> Result<Vec<InstalledExtension>, String> {
    let dir = user_extensions_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("readdir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(manifest) = read_extension_manifest(&app, &path) {
            out.push(to_installed(&manifest, &path));
        }
    }
    Ok(out)
}
