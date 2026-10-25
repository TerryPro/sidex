# 移除 SideX Agent 功能 — 实施方案

## Context

用户判断内置 AI agent 对当前使用场景无用，要求**彻底删除**，而不是隐藏入口。删除范围包含：右侧专用布局部件 SidexPart、聊天面板（sidexChat）、行内补全（sidexComplete）、SideX 产品设置面板、Rust 侧 12 个 agent 命令模块与子进程监督器、Go 写的 agent 服务 `sidexai/`，以及 `crates/sidex-agent`、`crates/sidex-context` 两个 crate。

目标：删除后 `npx tsc --noEmit`、`npm run build`、`cargo check --workspace` 全部通过；`npx tauri dev` 启动后窗口布局、拖拽、zen mode、尺寸记忆等原有编辑器能力正常，没有空白面板或残留菜单。

## 删除边界

| 处理 | 内容 |
|---|---|
| 删除 | 前端 `src/vs/workbench/contrib/sidexChat/`、`contrib/sidexComplete/`、`browser/parts/sidex/` |
| 删除 | Rust `src-tauri/src/server.rs` 与 `commands/{agent,auth,providers,chat_sessions,next_gen_tools,index,hooks,mcp,browser,orchestrate,compress,context_format}.rs` |
| 删除 | `crates/sidex-agent/`、`crates/sidex-context/` |
| 删除 | 整个 `sidexai/`（Go 服务）；`package.json` 的 `server:build`；`scripts/dev-local.sh` |
| 保留 | 扩展宿主（`ext_host.rs`、`extension_platform.rs`、`extension_wasm.rs`、`extension-host/`）、`sidexUpdate` 更新面板（走原生 `sidex-update`，与 Go 服务无关） |
| 保留 | `platform/sidex/*` 平台服务（文件系统/搜索/SCM/语法/LSP/DAP/远程/主题/设置/键位） |
| 保留 | `crates/sidex-auth`（被 `commands/secrets.rs` 使用）、`secrets.rs`、`profiles.rs`、`updater.rs` 及其他编辑器 crate |

## 实施步骤

### 阶段 0：安全基线

- 建议先 `git checkout -b remove-agent` 并提交当前状态（目前工作区只有 `vite.config.ts` 的改动），确保可整体回滚。

### 阶段 1：前端布局部件拆除

| 文件 | 改动 |
|---|---|
| [sidexPart.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/browser/parts/sidex/sidexPart.ts) | 删除整个 `parts/sidex/` 目录 |
| [layoutService.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/services/layout/browser/layoutService.ts#L36) | 删除 `Parts.SIDEX_PART` 枚举项 |
| [workbench.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/browser/workbench.ts#L423) | 删除 part 描述项 |
| [paneCompositePartService.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/browser/parts/paneCompositePartService.ts#L15-L42) | 删除 import、`createInstance(SidexPart)`、`paneCompositeParts.set(...)` 与位置列表第 4 项 |
| [views.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/common/views.ts) | 删除 `ViewContainerLocation.Sidex` 及 `ViewContainerLocationToString` 的 case |
| [panecomposite.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/browser/panecomposite.ts#L212-L249) | 删除 `Extensions.Sidex` 与对应的 `Registry.add` |
| [contextkeys.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/common/contextkeys.ts#L424-L437) | 删除 `ActiveSidexContext`、`SidexFocusContext` 整个 region（删除前用 rg 确认无其他使用方） |
| [viewDescriptorService.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/services/views/browser/viewDescriptorService.ts#L432) | 删除 Sidex 相关分支；对旧持久化的自定义位置值（历史值 3）加兜底，回退到默认位置，避免读档后视图丢失 |

### 阶段 2：layout.ts 方法级删除（最大风险点）

删除策略是"删分支、不留空壳"，并保证 `viewMap` 与 grid descriptor 同步收缩。

| 区域 | 改法 |
|---|---|
| 字段与 import（L125、L371、L154） | 删 `SidexPart` import、`sidexPartView` 字段、`containerToRestore.sidex` |
| `createWorkbenchLayout`（L1938-L2055） | 删 `getPart(SIDEX_PART)`、`viewMap` 中对应项、可见性回调数组中的 `sidexPart` 与 `part === sidexPart` 分支、`onWillSaveState` 里的 Sidex Size 块 |
| `createGridDescriptor` / `arrangeEditorNodes`（L3064-L3090） / `arrangeMiddleSectionNodes`（L3112-L3149） | 删 `nodes.sidex` 参数与排序分支、`sidexSize` 计算及宽度扣减 |
| `adjustPartPositions`（L2368-L2470） | 删 `preMoveSidexSize`、两处 `sidexPartView` move/resize；辅助栏锚点改为 `editorPartView` |
| `focusPart` / `isVisible` / `resizePart` / `setPartHidden` / `getVisibleNeighborPart`（L1568、L1631、L2188、L2762-L2772、L2810、L3026） | 直接删 `case Parts.SIDEX_PART` 与其方法体 |
| `getMaximumEditorDimensions`（L1679）、`getLayoutClasses`（L2270） | 删 sidex 宽度加项与 `LayoutClasses.SIDEX_HIDDEN` |
| `setSideBarPosition`（L778）、`toggleAuxiliaryBarMaximized`（L2626）、`setPanelPosition`（L2897-L2971） | 删对应 Sidex 处理 |
| `toggleZenMode`（L1750、L1871） | 删 `wasVisible.sidex` 记录与恢复、`zenModeExitInfo` 默认值中的 `sidex` |
| restore 逻辑（L996-L1005、L1341、L1417-L1430） | 删 Sidex 视图恢复分支 |
| `LayoutStateKeys`（L3869-L3888） | 删 `SIDEX_SIZE`、`SIDEX_HIDDEN` 及小窗口 clamp |

不变量提示：`viewMap` 必须与 grid descriptor 的 leaf 一一对应，否则 `SerializableGrid.deserialize` 会拿到 `undefined` 直接白屏；两处必须同一次改动完成。

### 阶段 3：入口、标题栏、文案

- [workbench.common.main.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/workbench.common.main.ts#L213-L218)：删 sidexChat / sidexComplete 两个 import（保留上方 `platform/sidex/*` 与 `sidexNullServices`）。
- [titlebarPart.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/browser/parts/titlebar/titlebarPart.ts#L59)：删 `IAccountService` import、构造注入、账号首字母逻辑（保留静态 `U` 兜底）、L798 动态 import 的 `openSidexSettings`、"SideX Settings"/"SideX Usage" 两个 action 及其分隔符。保留 Editor Settings、Command Palette、Extensions 等其余菜单项与 profile 按钮。
- 删除 `contrib/sidexChat/`、`contrib/sidexComplete/` 整个目录。
- `panelActions.ts`（L532-L553）：删除重复的 "Move Sidex Views To Panel" 动作，保留原生 Secondary Side Bar 动作。
- CSS 与品牌文案（`styles.css`、`titlebarpart.css`、`sidex-logo` 等）保留，它们属于产品外观而非 agent。

### 阶段 4：Rust 命令层

- 删除 `server.rs` 与 12 个 agent 命令文件。
- [commands/mod.rs](file:///f:/TRAEWS/sidex/src-tauri/src/commands/mod.rs)：删对应 `pub mod` 与 `pub use`。
- [lib.rs](file:///f:/TRAEWS/sidex/src-tauri/src/lib.rs)：删 `mod server`、`AuthState/IndexStore/OrchestrationStore` 的 use、L454-L468 的 agent state `manage`、L671-L675 的 `server::initialize`、L686-L705 的 agent/providers/accounts/auth 命令、L894-L896、L948-L950、L998-L1033 与退出时的 shutdown 逻辑。
- 顺带删除空模块 `commands/models.rs`（若确认无内容）。

### 阶段 5：crates 与 workspace

- 删除 `crates/sidex-agent/`、`crates/sidex-context/`。
- 根 [Cargo.toml](file:///f:/TRAEWS/sidex/Cargo.toml)：删 workspace.members 两项与 `workspace.dependencies.sidex-context`。
- [src-tauri/Cargo.toml](file:///f:/TRAEWS/sidex/src-tauri/Cargo.toml)：删 `sidex-agent`、`sidex-context` 两条 path 依赖。

### 阶段 6：Go 服务、构建脚本与文档

- 删除 `sidexai/` 整个目录。
- [package.json](file:///f:/TRAEWS/sidex/package.json#L7)：删 `server:build`。
- 删除 `scripts/dev-local.sh`；`.gitignore` 里 sidexai 相关条目清理。
- 文档：[README.md](file:///f:/TRAEWS/sidex/README.md)（Why/AI Agent/项目结构/技术栈/What's Working 中 agent 相关段落）、[ARCHITECTURE.md](file:///f:/TRAEWS/sidex/ARCHITECTURE.md)（Agent Server 整章、Rust 命令表中 agent 模块行）、[CONTRIBUTING.md](file:///f:/TRAEWS/sidex/CONTRIBUTING.md)、`.env.example` 中 provider/server 变量。

## 验证

1. 残留扫描：
   ```
   rg -n "SIDEX_PART|ViewContainerLocation\.Sidex|sidexChat|sidexComplete|sidex-server|sidexai|ActiveSidex|SidexFocus" src src-tauri crates
   ```
   预期只剩品牌词（SideX 名称、`__SIDEX_TAURI__` 等）。
2. 前端：`npx tsc --noEmit` → `npx eslint 'src/**/*.ts'` → `npm run build`。
3. 后端：`cargo check --workspace`（根目录）→ `cd src-tauri && cargo clippy --all-targets -- -D warnings`。注意构建需带 `AWS_LC_SYS_PREBUILT_NASM=1`（本机无 NASM）。
4. 运行：`$env:AWS_LC_SYS_PREBUILT_NASM=1; npx tauri dev`，人工确认：
   - 主界面无空白侧栏/布局断层；编辑器可正常打开文件夹、终端、Git。
   - 左右侧栏切换、侧栏拖拽、面板四方位、面板最大化、辅助栏最大化、zen mode 进出。
   - 关闭重启后窗口尺寸与面板可见性记忆正常（旧 `sidex.*` 状态应被忽略而不是报错）。
   - 标题栏 profile 菜单无 "SideX Settings/Usage"，Editor Settings 等仍在；`Cmd+Shift+I` 无绑定；无行内补全。
   - 控制台无 `unknown view container` / `undefined` 类报错；进程列表无 `sidex-server`。

## 风险与回滚

- **最高风险**：layout.ts 的 grid descriptor / viewMap 不同步 → 启动白屏。验证时先跑 `tsc` 再直接启动观察。
- 旧 localStorage 可能残留 `workbench.parts.sidex` 的尺寸/隐藏状态与视图位置值 3，已通过删除对应 key 与兜底逻辑规避。
- 大范围删除后可能有未使用依赖（`tokio-tungstenite`、`futures-util`、`hive` 等），不影响编译，可按需再清理。
- UI 行为无法自动化验证，只能人工确认；保留分支 `remove-agent`，出问题可整体回滚。
