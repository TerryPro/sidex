//! Extension catalogue utilities for `SideX`.
//!
//! This crate provides the declarative extension pieces the desktop shell
//! still uses: `package.json` manifest parsing and standard storage paths.

pub mod encoding;
pub mod manifest;
pub mod paths;

pub use manifest::{
    build_extension_descriptions, build_init_data, is_version_greater, parse_manifest,
    path_to_uri_path, read_node_manifest, sanitize_ext_id, ExtensionContributes,
    ExtensionDescription, ExtensionHostInitData, ExtensionIdentifier, ExtensionKind,
    ExtensionManifest, UriComponents,
};
pub use paths::{global_storage_dir, sidex_data_dir, user_data_dir, user_extensions_dir};
