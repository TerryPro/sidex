use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionKind {
    Node,
}

/// Extension manifest record produced entirely by Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub publisher: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub path: String,
    pub kind: ExtensionKind,
    pub main: Option<String>,
    pub browser: Option<String>,
    pub source: String,
    pub builtin: bool,
    pub activation_events: Vec<String>,
    pub contributes_keys: Vec<String>,
    #[serde(default)]
    pub commands: Vec<ManifestCommand>,
    #[serde(default)]
    pub menus: HashMap<String, Vec<ManifestMenuItem>>,
}

/// Command contributed by an extension (`contributes.commands`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCommand {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
}

/// Menu item contributed by an extension (`contributes.menus.<menuId>`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMenuItem {
    pub command: String,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
}

pub fn path_to_uri_path(path: &str) -> String {
    let stripped = path.strip_prefix(r"\\?\").unwrap_or(path);
    let p = stripped.replace('\\', "/");
    if p.starts_with('/') {
        p
    } else {
        format!("/{p}")
    }
}

pub fn user_extensions_dir() -> PathBuf {
    sidex_extensions::paths::user_extensions_dir()
}

pub fn global_storage_dir() -> PathBuf {
    sidex_extensions::paths::global_storage_dir()
}

pub fn resolve_builtin_extensions_dir(app: &AppHandle) -> PathBuf {
    let resource_extensions = app
        .path()
        .resolve("extensions", tauri::path::BaseDirectory::Resource)
        .ok();

    if let Some(ref p) = resource_extensions {
        if p.exists() {
            return p.clone();
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("extensions")
}

fn extension_source(app: &AppHandle, path: &Path) -> (String, bool) {
    let builtin_dir = resolve_builtin_extensions_dir(app);
    let user_dir = user_extensions_dir();
    if path.starts_with(&builtin_dir) {
        ("builtin".to_string(), true)
    } else if path.starts_with(&user_dir) {
        ("user".to_string(), false)
    } else {
        ("external".to_string(), false)
    }
}

fn is_version_greater(a: &str, b: &str) -> bool {
    sidex_extensions::manifest::is_version_greater(a, b)
}

fn manifest_entry_exists(ext_dir: &Path, entry: &str) -> bool {
    let entry_path = ext_dir.join(entry);
    entry_path.exists() || entry_path.with_extension("js").exists()
}

pub fn read_extension_manifest(
    app: &AppHandle,
    ext_dir: &Path,
) -> Result<ExtensionManifest, String> {
    let pkg_path = ext_dir.join("package.json");
    let val: serde_json::Value = crate::commands::encoding::read_json_file(&pkg_path)?;

    let publisher = val
        .get("publisher")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let name = val
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("manifest missing 'name' in {}", pkg_path.display()))?
        .to_string();
    let display_name = val
        .get("displayName")
        .and_then(|v| v.as_str())
        .unwrap_or(&name)
        .to_string();
    let version = val
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    let main = val.get("main").and_then(|v| v.as_str()).map(str::to_string);
    let browser = val
        .get("browser")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let entry = main.as_ref().or(browser.as_ref());
    if let Some(entry) = entry {
        if !manifest_entry_exists(ext_dir, entry) {
            return Err(format!(
                "entry '{entry}' missing for extension {publisher}.{name}"
            ));
        }
    }

    let activation_events: Vec<String> = val
        .get("activationEvents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let contributes_keys: Vec<String> = val
        .get("contributes")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();

    let commands: Vec<ManifestCommand> = val
        .get("contributes")
        .and_then(|c| c.get("commands"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?.to_string();
                    let title = item
                        .get("title")
                        .map(|title| {
                            title
                                .as_str()
                                .map(str::to_string)
                                .or_else(|| {
                                    title.get("value").and_then(|v| v.as_str()).map(str::to_string)
                                })
                                .unwrap_or_else(|| id.clone())
                        })
                        .unwrap_or_else(|| id.clone());
                    let icon = item.get("icon").and_then(|icon| {
                        icon.as_str()
                            .map(str::to_string)
                            .or_else(|| icon.get("light").and_then(|v| v.as_str()).map(str::to_string))
                    });
                    Some(ManifestCommand { id, title, icon })
                })
                .collect()
        })
        .unwrap_or_default();

    let menus: HashMap<String, Vec<ManifestMenuItem>> = val
        .get("contributes")
        .and_then(|c| c.get("menus"))
        .and_then(|v| v.as_object())
        .map(|menus| {
            menus
                .iter()
                .filter_map(|(menu, items)| {
                    let items = items.as_array()?;
                    let parsed: Vec<ManifestMenuItem> = items
                        .iter()
                        .filter_map(|item| {
                            let command = item.get("command")?.as_str()?.to_string();
                            Some(ManifestMenuItem {
                                command,
                                when: item
                                    .get("when")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string),
                                group: item
                                    .get("group")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string),
                            })
                        })
                        .collect();
                    Some((menu.clone(), parsed))
                })
                .collect()
        })
        .unwrap_or_default();

    let (source, builtin) = extension_source(app, ext_dir);

    Ok(ExtensionManifest {
        id: format!("{publisher}.{name}"),
        publisher,
        name,
        display_name,
        version,
        path: ext_dir.to_string_lossy().to_string(),
        kind: ExtensionKind::Node,
        main,
        browser,
        source,
        builtin,
        activation_events,
        contributes_keys,
        commands,
        menus,
    })
}
