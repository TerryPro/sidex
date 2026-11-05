use serde::Serialize;
use std::path::Path;

/// Declarative extension manifest record produced entirely by Rust.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub publisher: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub path: String,
}

pub fn read_extension_manifest(ext_dir: &Path) -> Result<ExtensionManifest, String> {
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

    Ok(ExtensionManifest {
        id: format!("{publisher}.{name}"),
        publisher,
        name,
        display_name,
        version,
        path: ext_dir.to_string_lossy().to_string(),
    })
}
