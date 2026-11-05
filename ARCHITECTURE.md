# SideX Architecture

A technical reference for how SideX maps to VS Code's architecture.

SideX is a Windows file manager with a built-in editor. It keeps VS Code's
workbench shell because that shell is what makes the editor feel familiar,
but the feature surface is deliberately narrow: file browsing, editing,
previewing and a terminal. No Git, no extension marketplace, no language
servers.

The VS Code source (MIT License) is the architectural reference. No proprietary code is used.

可视化版本：[SideX 文件管理器与编辑器架构](.archify/architecture-sidex-detailed-20261105-125655/sidex-architecture.html)

## Process Model

```
VSCode (Electron)                    SideX (Tauri)
─────────────────                    ─────────────
Electron Main Process        →       Tauri Rust Backend
  ├─ BrowserWindow           →       WebviewWindow
  ├─ ipcMain                 →       Tauri Commands + Events
  ├─ Menu/Dialog/Shell       →       Tauri Plugins
  └─ UtilityProcess          →       Rust async tasks

Renderer Process             →       Tauri Webview (frontend TS)
  ├─ Workbench               →       Workbench (same TS)
  ├─ Monaco Editor           →       Monaco Editor (same)
  └─ Extension Host API      →       Extension Host API (ported)

Shared Process               →       Rust service layer
Extension Host               →       built-in declarative extensions only
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
| `autoUpdater` | — | Removed (no auto-update) |
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
| `api/` (Extension host) | VS Code API compatibility subset | Done |

### code/ (Application Entry)
| Sublayer | Strategy | Status |
|---|---|---|
| `electron-main/` | Full rewrite → Tauri Rust | Done |
| `electron-browser/` | Rewrite → Tauri webview | Done |

## Rust Backend Commands

All Tauri commands are registered in `src-tauri/src/lib.rs`. The table below
covers the modules most central to this doc's architecture story — the
command surface has grown well past what fits here (syntax analysis and more
all live in `src-tauri/src/commands/` too). `lib.rs` is the source of truth for
the full, current list.

| Module | Commands |
|---|---|
| **fs** | `read_file`, `read_file_bytes`, `write_file`, `write_file_bytes`, `read_dir`, `list_drives`, `stat`, `mkdir`, `remove`, `rename`, `exists` |
| **terminal** | `terminal_spawn`, `terminal_write`, `terminal_resize`, `terminal_kill`, `terminal_get_pid`, `get_default_shell`, `check_shell_exists`, `get_available_shells` |
| **search** | `search_files`, `search_text`, `search_workspace`, `search_workspace_grouped`, `search_workspace_replace_preview`, `search_workspace_replace_apply` |
| **window** | `create_window`, `close_window`, `set_window_title`, `get_monitors` |
| **os** | `get_os_info`, `get_env`, `get_all_env`, `get_shell` |
| **storage** | `storage_get`, `storage_set`, `storage_list`, `storage_delete` |
| **syntax** | `syntax_get_document_symbols`, `syntax_get_folding_ranges` |
| **extension_platform** | `list_available_extensions` |
| **network** | `proxy_request`, `proxy_request_full` |

There is no Git module. Source control was removed along with the rest of the
VS Code feature surface that a file manager does not need.

## Extension Host

SideX has no extension runtime. The only extension form is the declarative
catalogue under `extensions/`: TextMate grammars, themes and language
configuration, scanned into the workbench at startup.

CSV files are handled by the built-in native editor pane in
`src/vs/workbench/contrib/csvPreview/`. It parses the file, renders an editable
table and writes back through `IFileService`. There is no wasmtime, WIT contract
or `.wasm` component in the product.

SideX has no language server layer. Keyword colouring comes from TextMate
grammars (`commands/textmate.rs`), folding from Monaco indentation plus native
brace/Markdown ranges. TypeScript/JavaScript outlines use tree-sitter via
`tree-sitter-typescript`; other languages use regex-based symbol extraction in
`commands/syntax.rs` (`syntax_get_document_symbols`,
`syntax_get_folding_ranges`).

The bundled `extensions/` tree holds declarative extensions only — grammars,
themes and language configuration. There is no Node extension host and no
marketplace client.

