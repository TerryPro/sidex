# SideX Architecture

A technical reference for how SideX maps to VSCode's architecture.

The VSCode source (MIT License) is the architectural reference. No proprietary code is used.

可视化版本：[SideX 架构：WASM 扩展与语言能力](.archify/architecture-sidex-wasm-20261026-130123/sidex-architecture.html)

## Process Model

```
VSCode (Electron)                    SideX (Tauri)
─────────────────                    ─────────────
Electron Main Process        →       Tauri Rust Backend
  ├─ BrowserWindow           →       WebviewWindow
  ├─ ipcMain                 →       Tauri Commands + Events
  ├─ Menu/Dialog/Shell       →       Tauri Plugins
  └─ UtilityProcess          →       Rust async tasks / sidecars

Renderer Process             →       Tauri Webview (frontend TS)
  ├─ Workbench               →       Workbench (same TS)
  ├─ Monaco Editor           →       Monaco Editor (same)
  └─ Extension Host API      →       Extension Host API (ported)

Shared Process               →       Rust service layer
Extension Host               →       WASM runtime in-process (Node sidecar optional, off by default)
```

## VSCode Layering (Preserved)

```
┌─────────────────────────────────────────────┐
│  code/        → Application entry (Tauri)   │
├─────────────────────────────────────────────┤
│  workbench/   → IDE shell                   │
│    ├── Feature contributions (contrib/)     │
│    ├── Services (services/)                 │
│    ├── Visual Parts (browser/parts/)        │
│    ├── Extension host API (api/)            │
│    └── Layout engine (browser/layout.ts)    │
├─────────────────────────────────────────────┤
│  editor/      → Monaco text editor core     │
├─────────────────────────────────────────────┤
│  platform/    → Platform services (DI)      │
├─────────────────────────────────────────────┤
│  base/        → Foundation utilities        │
└─────────────────────────────────────────────┘
```

## Electron API Replacement Map

| Electron API | Tauri Replacement | Status |
|---|---|---|
| `BrowserWindow` | `WebviewWindow` | Ported |
| `ipcMain/ipcRenderer` | `invoke()` / `emit()` / `listen()` | Ported |
| `Menu/MenuItem` | `tauri::menu::Menu` | Ported |
| `dialog.*` | `@tauri-apps/plugin-dialog` | Ported |
| `clipboard` | `@tauri-apps/plugin-clipboard-manager` | Ported |
| `shell.openExternal` | `@tauri-apps/plugin-opener` | Ported |
| `Notification` | `@tauri-apps/plugin-notification` | Ported |
| `safeStorage` | Rust keyring crate | Partial |
| `protocol.*` | Tauri custom protocol | Ported |
| `screen/Display` | Tauri monitor API | Ported |
| `contextBridge` | `@tauri-apps/api` (direct) | Ported |
| `node-pty` | `portable-pty` (Rust) | Ported |
| `@parcel/watcher` | `notify` (Rust) | Ported |
| `child_process` | `std::process::Command` | Ported |
| `fs/fs.promises` | `@tauri-apps/plugin-fs` + Rust fs | Ported |
| `net/http` | `reqwest` (Rust) | Ported |
| `crypto` | Web Crypto API | Partial |
| `os.*` | `sysinfo` (Rust) | Ported |
| `@vscode/sqlite3` | `rusqlite` | Ported |
| `@vscode/spdlog` | `tracing` + `tracing-subscriber` | Partial |
| `autoUpdater` | `sidex-update` (native Rust) | Complete |
| `powerMonitor` | Rust system-info crates | Not started |
| `contentTracing` | Rust tracing crate | Not started |
| `native-keymap` | Rust keyboard crate | Not started |

## Porting Status by Layer

### base/ (Foundation)
| Sublayer | Strategy | Status |
|---|---|---|
| `common/` | Reuse directly (pure TS) | Done |
| `browser/` | Reuse directly (DOM only) | Done |
| `worker/` | Reuse directly (Web Workers) | Done |
| `node/` | Rewrite → Tauri invoke() | Done |
| `parts/ipc` | Rewrite for Tauri IPC | Done |
| `parts/storage` | Rewrite → Rust SQLite | Done |

### platform/ (Services)
| Service | Strategy | Status |
|---|---|---|
| `instantiation` (DI) | Reuse directly | Done |
| `files` | Tauri fs plugin + Rust | Done |
| `windows` | Tauri window API | Done |
| `configuration` | Mostly reuse | Done |
| `storage` | Rust SQLite backend | Done |
| `keybinding` | Mostly reuse | Done |
| `commands` | Reuse directly | Done |
| `contextkey` | Reuse directly | Done |
| `theme` | Reuse directly | Done |
| `log` | Rust tracing backend | Partial |
| `terminal` | Rust portable-pty | Done |
| `dialogs` | Tauri dialog plugin | Done |
| `clipboard` | Tauri clipboard plugin | Done |
| `native` | Rust OS integration | Partial |
| `encryption` | Rust keyring | Partial |

### editor/ (Monaco)
| Sublayer | Strategy | Status |
|---|---|---|
| `common/` | Reuse directly | Done |
| `browser/` | Reuse directly (DOM) | Done |
| `contrib/` (57 contributions) | Reuse directly | Done |
| `standalone/` | Removed (not needed in Tauri) | Deleted |

### workbench/ (IDE Shell)
| Sublayer | Strategy | Status |
|---|---|---|
| `browser/layout` | Reuse with mods | Done |
| `browser/parts` (8 Parts) | Reuse with mods | Done |
| `contrib/` (92 features) | Incremental port | Partial |
| `services/` (90 services) | Incremental port | Partial |
| `api/` (Extension host) | Port | In progress |

### code/ (Application Entry)
| Sublayer | Strategy | Status |
|---|---|---|
| `electron-main/` | Full rewrite → Tauri Rust | Done |
| `electron-browser/` | Rewrite → Tauri webview | Done |

## Rust Backend Commands

All Tauri commands are registered in `src-tauri/src/lib.rs`. The table below
covers the modules most central to this doc's architecture story — the
command surface has grown well past what fits here (LSP management, WASM
extensions, remote development, and more all live in
`src-tauri/src/commands/` too). `lib.rs` is the source of truth for the full,
current list.

| Module | Commands |
|---|---|
| **fs** | `read_file`, `read_file_bytes`, `write_file`, `write_file_bytes`, `read_dir`, `stat`, `mkdir`, `remove`, `rename`, `exists` |
| **terminal** | `terminal_spawn`, `terminal_write`, `terminal_resize`, `terminal_kill`, `terminal_get_pid`, `get_default_shell`, `check_shell_exists`, `get_available_shells` |
| **search** | `search_files`, `search_text` |
| **window** | `create_window`, `close_window`, `set_window_title`, `get_monitors` |
| **os** | `get_os_info`, `get_env`, `get_all_env`, `get_shell` |
| **storage** | `storage_get`, `storage_set`, `storage_delete` |
| **git** | `git_status`, `git_diff`, `git_log`, `git_log_graph`, `git_add`, `git_commit`, `git_checkout`, `git_branches`, `git_create_branch`, `git_delete_branch`, `git_push`, `git_pull`, `git_fetch`, `git_stash`, `git_reset`, `git_show`, `git_init`, `git_is_repo`, `git_clone`, `git_remote_list`, `git_run` |
| **extension_platform** | `extension_platform_bootstrap`, `extension_platform_status`, `extension_platform_restart`, `extension_platform_stop`, `extension_platform_init_data` |
| **network** | `proxy_request`, `proxy_request_full` |

## Extension Host

The extension host is WASM-first. `src-tauri/src/commands/extension_wasm.rs`
loads `.wasm` components through the wasmtime component model against the WIT
contract in `src-tauri/wit/world.wit`. Seven Rust extensions ship in
`extensions-rust/` and activate lazily on `onLanguage:<id>` events, so opening a
TypeScript or Rust file instantiates only the extensions that declare it.

The workbench side lives in
`src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts`.
It registers the WASM provider results as ordinary language features
(completion, hover, references, rename, code actions, folding, inlay hints and
more) and mirrors diagnostics into the marker service, which is what feeds the
Problems panel.

Language servers run per extension, not through `commands/lsp.rs`: an extension
calls `__sidex.lsp`, the host spawns `rust-analyzer` or `tsserver`, and a
background reader thread keeps the JSON-RPC stream open. Server-pushed
`textDocument/publishDiagnostics` notifications are queued and handed back to
the workbench through `wasm_get_diagnostics`.

The Node sidecar in `commands/ext_host.rs` still exists, but it only starts when
`SIDEX_NODE_EXTENSIONS=on`. With it off, the bundled `extensions/` tree holds
declarative extensions only — grammars, themes and language configuration.

