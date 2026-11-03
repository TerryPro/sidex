use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionKind {
    Node,
    Wasm,
}

/// Extension manifest record produced entirely by Rust.
/// Works for both Node (package.json) and WASM (sidex.toml) extensions.
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
    pub wasm_binary: Option<String>,
    pub source: String,
    pub builtin: bool,
    pub activation_events: Vec<String>,
    pub contributes_keys: Vec<String>,
    #[serde(default)]
    pub custom_editors: Vec<WasmCustomEditorContribution>,
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

/// Custom editor declared by a WASM extension through `[contributes.custom-editors]`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmCustomEditorContribution {
    pub view_type: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub filename_patterns: Vec<String>,
    pub priority: Option<String>,
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

#[derive(Debug, Deserialize)]
struct SidexTomlManifest {
    extension: SidexTomlExtension,
    activation: Option<SidexTomlActivation>,
    contributes: Option<SidexTomlContributes>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SidexTomlExtension {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    wasm: String,
}

#[derive(Debug, Deserialize)]
struct SidexTomlActivation {
    #[serde(default)]
    events: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SidexTomlContributes {
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default)]
    commands: Vec<SidexTomlCommand>,
    #[serde(default, rename = "custom-editors")]
    custom_editors: Vec<SidexTomlCustomEditor>,
    #[serde(default)]
    menus: HashMap<String, Vec<SidexTomlMenuItem>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SidexTomlCommand {
    id: String,
    title: String,
    #[serde(default)]
    icon: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SidexTomlMenuItem {
    command: String,
    #[serde(default)]
    when: Option<String>,
    #[serde(default)]
    group: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SidexTomlCustomEditor {
    #[serde(rename = "viewType")]
    view_type: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
    #[serde(default, rename = "filenamePatterns")]
    filename_patterns: Vec<String>,
    #[serde(default)]
    priority: Option<String>,
}

pub fn read_wasm_extension_manifest(
    app: &AppHandle,
    ext_dir: &Path,
) -> Result<ExtensionManifest, String> {
    let toml_path = ext_dir.join("sidex.toml");
    let raw_bytes =
        fs::read(&toml_path).map_err(|e| format!("read {}: {e}", toml_path.display()))?;
    let raw = crate::commands::encoding::decode_utf8_strict(&raw_bytes)
        .map_err(|e| format!("decode {}: {e}", toml_path.display()))?;
    let manifest: SidexTomlManifest =
        toml::from_str(raw).map_err(|e| format!("parse {}: {e}", toml_path.display()))?;

    let wasm_path = ext_dir.join(&manifest.extension.wasm);
    if !wasm_path.exists() {
        return Err(format!(
            "wasm binary '{}' not found for extension {}",
            manifest.extension.wasm, manifest.extension.id
        ));
    }

    let parts: Vec<&str> = manifest.extension.id.splitn(2, '.').collect();
    let (publisher, name) = if parts.len() == 2 {
        (parts[0].to_string(), parts[1].to_string())
    } else {
        ("unknown".to_string(), manifest.extension.id.clone())
    };

    let activation_events = manifest.activation.map(|a| a.events).unwrap_or_default();

    let mut contributes_keys = Vec::new();
    if let Some(ref c) = manifest.contributes {
        if !c.languages.is_empty() {
            contributes_keys.push("languages".to_string());
        }
        if !c.commands.is_empty() {
            contributes_keys.push("commands".to_string());
        }
        if !c.custom_editors.is_empty() {
            contributes_keys.push("customEditors".to_string());
        }
    }

    let (source, builtin) = extension_source(app, ext_dir);

    let custom_editors = manifest
        .contributes
        .as_ref()
        .map(|contributes| {
            contributes
                .custom_editors
                .iter()
                .map(|editor| WasmCustomEditorContribution {
                    view_type: editor.view_type.clone(),
                    display_name: editor.display_name.clone(),
                    filename_patterns: editor.filename_patterns.clone(),
                    priority: editor.priority.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    let commands = manifest
        .contributes
        .as_ref()
        .map(|contributes| {
            contributes
                .commands
                .iter()
                .map(|command| ManifestCommand {
                    id: command.id.clone(),
                    title: command.title.clone(),
                    icon: command.icon.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    let menus = manifest
        .contributes
        .as_ref()
        .map(|contributes| {
            contributes
                .menus
                .iter()
                .map(|(menu, items)| {
                    (
                        menu.clone(),
                        items
                            .iter()
                            .map(|item| ManifestMenuItem {
                                command: item.command.clone(),
                                when: item.when.clone(),
                                group: item.group.clone(),
                            })
                            .collect(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ExtensionManifest {
        id: manifest.extension.id,
        publisher,
        name,
        display_name: manifest.extension.name,
        version: manifest.extension.version,
        path: ext_dir.to_string_lossy().to_string(),
        kind: ExtensionKind::Wasm,
        main: None,
        browser: None,
        wasm_binary: Some(manifest.extension.wasm),
        source,
        builtin,
        activation_events,
        contributes_keys,
        custom_editors,
        commands,
        menus,
    })
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
        wasm_binary: None,
        source,
        builtin,
        activation_events,
        contributes_keys,
        custom_editors: Vec::new(),
        commands,
        menus,
    })
}

pub fn extension_search_paths(app: &AppHandle) -> Vec<PathBuf> {
    let builtin_ext = resolve_builtin_extensions_dir(app);
    // NOTE: we intentionally do NOT scan other editors' extension dirs
    // (~/.vscode/extensions, ~/.cursor/extensions, or their app bundles).
    // Loading foreign user extensions pulls in incompatible/platform-native
    // extensions and can mutate the user's other-editor runtimes.
    let dist_ext = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("dist")
        .join("extensions");
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let rust_ext = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("extensions-rust");

    let candidates = vec![
        user_extensions_dir(),
        builtin_ext,
        rust_ext,
        dist_ext,
        cwd.join("extensions"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("extensions"),
    ];

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for candidate in candidates {
        if candidate.as_os_str().is_empty() {
            continue;
        }
        // canonicalize yields `\\?\C:\...` extended-length paths on Windows,
        // which Node's CJS resolver cannot handle; dunce strips the prefix
        // when safe and is a pass-through elsewhere.
        let normalized = dunce::simplified(
            &candidate
                .canonicalize()
                .unwrap_or_else(|_| candidate.clone()),
        )
        .to_path_buf();
        if seen.insert(normalized.clone()) {
            out.push(normalized);
        }
    }
    out
}

pub fn scan_extensions(app: &AppHandle, paths: &[PathBuf]) -> Vec<ExtensionManifest> {
    let mut disable_ids: HashSet<String> = std::env::var("SIDEX_DISABLE_EXTENSION_IDS")
        .unwrap_or_else(|_| "ms-python.vscode-pylance".to_string())
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();

    for id in &[
        "GitHub.copilot",
        "GitHub.copilot-chat",
        "sswg.swift-lang",
        "vscode.github-authentication",
        "vscode.microsoft-authentication",
    ] {
        disable_ids.insert(id.to_string());
    }

    let disable_prefixes = ["anysphere.cursor", "cursor."];

    let mut by_id: HashMap<String, ExtensionManifest> = HashMap::new();
    for search_path in paths {
        let Ok(entries) = fs::read_dir(search_path) else {
            continue;
        };

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            let ext_dir = entry.path();
            let manifest = if ext_dir.join("sidex.toml").exists() {
                read_wasm_extension_manifest(app, &ext_dir)
            } else {
                read_extension_manifest(app, &ext_dir)
            };
            let Ok(manifest) = manifest else {
                continue;
            };

            if disable_ids.contains(&manifest.id)
                || disable_prefixes.iter().any(|p| manifest.id.starts_with(p))
            {
                continue;
            }

            let replace = match by_id.get(&manifest.id) {
                Some(existing) => is_version_greater(&manifest.version, &existing.version),
                None => true,
            };
            if replace {
                by_id.insert(manifest.id.clone(), manifest);
            }
        }
    }

    let mut values: Vec<_> = by_id.into_values().collect();
    values.sort_by_key(|a| a.id.clone());
    values
}

#[tauri::command]
pub async fn list_available_extensions(app: AppHandle) -> Result<Vec<ExtensionManifest>, String> {
    let paths = extension_search_paths(&app);
    Ok(scan_extensions(&app, &paths))
}

#[tauri::command]
pub async fn extension_platform_bootstrap(
    app: AppHandle,
    wasm_runtime: tauri::State<
        '_,
        std::sync::Arc<crate::commands::extension_wasm::WasmExtensionRuntime>,
    >,
) -> Result<serde_json::Value, String> {
    let paths = extension_search_paths(&app);
    let manifests = scan_extensions(&app, &paths);

    let wasm_manifests: Vec<ExtensionManifest> = manifests
        .iter()
        .filter(|m| m.kind == ExtensionKind::Wasm && m.wasm_binary.is_some())
        .cloned()
        .collect();

    if !wasm_manifests.is_empty() {
        let runtime = wasm_runtime.inner().clone();
        // Remember every discovered manifest so language-triggered extensions can
        // be instantiated later without rescanning the disk.
        runtime.register_extensions(wasm_manifests.clone());

        let app_handle = app.clone();
        let count = wasm_manifests.len();
        log::info!(
            "[platform] registered {count} WASM extensions, activating startup ones in background"
        );
        std::thread::spawn(move || {
            use tauri::Emitter;
            let activated = runtime
                .activate_for_events(&crate::commands::extension_wasm::startup_activation_events());
            log::info!(
                "[platform] {} of {count} WASM extensions activated at startup",
                activated.len()
            );
            let _ = app_handle.emit("sidex-wasm-extensions-ready", activated.len());
        });
    }

    let summaries: Vec<serde_json::Value> = manifests
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "name": m.display_name,
                "version": m.version,
                "kind": m.kind,
                "activationEvents": m.activation_events,
                "main": m.main,
                "browser": m.browser,
                "wasmBinary": m.wasm_binary,
                "contributes": m.contributes_keys,
                "commands": m.commands,
                "menus": m.menus,
                "location": m.path,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "paths": {
            "builtinExtensionsDir": dunce::simplified(&resolve_builtin_extensions_dir(&app)).to_string_lossy(),
            "userExtensionsDir": dunce::simplified(&user_extensions_dir()).to_string_lossy(),
            "globalStorageDir": dunce::simplified(&global_storage_dir()).to_string_lossy(),
        },
        "sessionKind": "local",
        "extensions": summaries,
    }))
}
