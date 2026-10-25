//! Generic secret storage for SideX.
//!
//! Despite the crate name, this has nothing to do with authentication —
//! SideX has no sign-in, so there are no tokens to manage. It's a plain
//! key-value secret store (see `commands::secrets` in the `sidex` crate);
//! callers pick their own keys, there's no fixed namespace.
//!
//! See `storage` for the keyring-backed implementation and its `SQLite`
//! fallback.

pub mod storage;

pub use storage::{SecretStorage, StorageError};
