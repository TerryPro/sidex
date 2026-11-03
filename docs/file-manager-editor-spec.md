# SideX 文件管理器编辑器：需求与实施计划

> 产品目标：把 SideX 从“项目制代码编辑器”改造成“基于目录和文件的、Windows 资源管理器式的多标签编辑器”。
>
> 保留现有编辑能力，不保留 VS Code 工作区/项目语义。

## 一、产品形态

### 1.1 两层标签

| 层级 | 名称 | 职责 |
| --- | --- | --- |
| 顶层 | 目录标签 | 绑定一个目录，类似 Windows 资源管理器标签 |
| 内部 | 文件标签 | 主区域中打开的文件编辑器标签 |

每个目录标签内部保留当前 SideX 的完整布局：

| 区域 | 行为 |
| --- | --- |
| 活动栏 | 全局，不随目录标签变化 |
| 侧边栏 | 按目录标签独立，记住当前视图与宽度 |
| 主区域 | 第一个标签固定为“文件列表”，双击文件在旁边新增编辑器标签 |
| 右侧辅助栏 | 单击文件时显示“预览 + 属性” |
| 底部面板 | 终端、输出、问题按目录标签独立 |
| 状态栏 | 显示当前目录、选中数量、大小等信息 |

### 1.2 界面形态

- 仅单窗口，不提供多窗口。
- 顶层目录标签栏位于标题栏下方。
- 文件列表默认“详细信息”视图，可切换“缩略图”网格。
- 文件列表列：名称、修改日期、类型、大小，支持排序与列宽持久化。

### 1.3 交互规则

| 操作 | 结果 |
| --- | --- |
| 打开目录 | 新建或切换到对应目录标签 |
| 打开单文件 | 若其父目录已有标签则切换，否则新建该目录标签 |
| 单击文件 | 右侧辅助栏显示预览与属性，不打开编辑器 |
| 双击文件 | 在当前目录标签新增编辑器标签，文件列表标签保留 |
| 关闭编辑器标签 | 回到文件列表；有未保存内容时确认 |
| 关闭目录标签 | 有未保存文件时逐个确认，可取消 |
| 同一文件多标签打开 | 共享文本模型和脏状态，光标各自独立 |
| 拖放 | 资源管理器语义：拖到目录移动/复制，Ctrl/Shift 调整，拖到标签栏打开 |
| 目录被删除或重命名 | 标签保留并提示定位，不自动关闭 |
| 重启恢复 | 恢复目录标签、文件列表标签、编辑器标签、光标位置、导航历史 |

### 1.4 文件管理能力

应用内完整 Windows 体验，不做系统级替换。

| 能力 | 要求 |
| --- | --- |
| 驱动器 | 本地盘、可移动盘、网络盘，显示卷标与剩余空间 |
| 地址栏 | 面包屑 + 可编辑路径 + 前进/后退/向上 |
| 系统图标 | 按文件类型显示 Windows 系统图标 |
| 缩略图 | 图片、视频、PDF 等异步缩略图与缓存 |
| 文件操作 | 新建、重命名、复制、移动、回收站删除、进度、取消、冲突处理、撤销 |
| 拖放 | 应用内跨目录/跨标签，系统拖入拖出 |
| 右键菜单 | 自绘菜单，不接第三方 Shell 扩展 |
| 属性 | 大小、类型、时间、路径、属性、所有者等 |
| 系统集成 | 不做默认打开方式、单实例、跳转列表、托盘、开机启动 |

### 1.5 编辑与扩展

| 项 | 决策 |
| --- | --- |
| 编辑器 | Monaco 全量保留 |
| 语言能力 | LSP 与 8 个 WASM 语言扩展保留 |
| 其他能力 | Git、终端、预览、自定义编辑器保留 |
| Node 扩展宿主 | 彻底删除 |
| 扩展市场 | 移除下载/市场面板，只保留内置扩展和 Rust/WASM 扩展 |
| 设置 | 仅用户级，不做目录/项目配置 |

## 二、技术架构

### 2.1 目录上下文

每个目录标签持有一个独立的 `DirectoryContext`：

| 字段 | 说明 |
| --- | --- |
| `root` | 标签绑定的目录 URI |
| `history` | 前进/后退/向上的导航历史 |
| `activeViewId` | 侧边栏当前视图 |
| `fileListState` | 视图模式、排序列、列宽、滚动位置 |
| `openEditors` | 文件标签集合、活动标签、光标位置 |
| `preview` | 右侧预览文件与属性 |
| `terminal` | 终端会话与 cwd |
| `search` | 搜索会话与范围 |
| `scm` | Git 仓库根与状态 |
| `outline` | 跟随活动文件 |

`IWorkspaceContextService` 内部继续保留，但其语义改为“已打开目录集合”，不再表示项目。UI 不出现“工作区/项目”字样。

### 2.2 关键改造点

| 模块 | 现状 | 改造 |
| --- | --- | --- |
| LSP 根目录 | 固定取 `workspace_folders.first()` | 按文件向上找项目标记，找不到用文件所在目录 |
| LSP 进程池 | 按 `server_name` 单实例 | 按 `(language, root)` 多实例，设上限与 LRU 回收 |
| 扩展文件沙箱 | 必须位于 workspace 内 | 按“已打开目录集合 + 当前文件父目录”授权 |
| 工作区同步 | 仅启动时同步一次 | 目录打开/关闭时增量同步 |
| 扩展状态 | `get-workspace-state` | 按目录路径哈希隔离 |
| TS 服务 | 只搜工作区 `node_modules` | 从当前文件向上找 `node_modules/typescript`，再回退内置 |
| 文件监听 | 工作区目录 | 已打开目录 + 已打开文件父目录 |
| 存储 | 工作区级 | 最近目录、最近文件、收藏夹、标签会话 |
| 终端 | 全局 | 每个目录标签独立终端组，cwd 跟随当前目录 |
| 搜索 | 工作区 | 每个目录标签独立会话 |
| Git | 工作区 | 每个目录标签按目录检测仓库 |

### 2.3 前端最大技术风险

现有 `EditorPart` 是全局单例，而需求要求每个目录标签拥有独立的文件标签集合。候选方案：

| 方案 | 优点 | 风险 |
| --- | --- | --- |
| 每标签保存/恢复编辑器状态 | 改动小 | 关闭文件后可能丢失撤销历史 |
| 每标签独立 `EditorPart` 实例 | 体验完整 | DOM 与内存成本高 |
| 单 `EditorPart` + 模型常驻 | 折中 | 切换逻辑复杂 |

阶段 2 开工前先做技术验证，再选定方案。

## 三、实施阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 0 | 删除 Node 扩展宿主、扩展市场、Node 扩展目录 | 编译通过，应用可启动，仅剩内置 + WASM 扩展 |
| 1 | 目录标签骨架、顶层标签栏、每标签侧边栏状态 | 可新建/切换/关闭目录标签，状态互不串 |
| 2 | 文件列表、右侧预览、编辑器标签 | 单击预览、双击编辑、文件列表固定标签 |
| 3 | 多根 LSP、扩展沙箱、终端/搜索/Git 隔离 | 多目录同时打开语言能力正常 |
| 4 | 文件操作与 Windows Shell | 驱动器、图标、缩略图、回收站、拖放、右键、属性 |
| 5 | 会话恢复、大目录性能、快捷键、最近/收藏 | 重启恢复完整，万级目录可用 |

## 四、阶段 0 清单

### 4.1 后端

- 删除 `src-tauri/src/commands/ext_host.rs`。
- 删除 `src-tauri/src/commands/mod.rs` 中的 `pub mod ext_host;`。
- 从 `src-tauri/src/lib.rs` 删除：
  - `ExtensionPlatformSupervisor` 导入、`manage` 注册、退出时停止逻辑。
  - `extension_platform_status`、`extension_platform_restart`、`extension_platform_stop`、`extension_platform_init_data` 注册。
  - `install_extension`、`install_extension_from_url`、`uninstall_extension`、`extension_search_marketplace` 注册。
- 精简 `extension_platform.rs`：
  - 删除 Node runtime 解析、Node init data、`resolve_server_script`、`build_extension_descriptions`、`build_init_data`。
  - 保留扩展扫描、WASM 清单、内置声明式扩展清单。
  - `extension_platform_bootstrap` 只返回扩展清单与路径。
- 删除 `src-tauri/extension-host/`。
- `tauri.conf.json` 移除 `extension-host/*` 资源。
- `extensions-node-disabled/` 先保留为备份，确认不再需要后再删除。

### 4.2 前端

- `extensionPlatformClient.ts` 删除 transport/runtime/initData/status 类型与命令封装，保留扩展清单。
- `tauriExtensionHost.contribution.ts` 删除 Node WebSocket 连接、重连、请求/响应、Node 安装/卸载监听。
- 扩展面板只保留「Rust 扩展」「内置扩展」，移除「下载」及市场/推荐视图注册。
- 删除 Open VSX 市场服务调用与安装 UI。

### 4.3 验收

- `cargo check` 通过，无新增错误。
- `npm run build` 通过。
- `npm run tauri dev` 可启动。
- 扩展面板只剩 Rust 扩展与内置扩展。
- 语言扩展、终端、Git、预览功能不受影响。

### 4.4 阶段 0 实施结果（2026-11-03）

| 项 | 结果 |
| --- | --- |
| Node 宿主进程 | 已删除 `ext_host.rs`、`extension-host/`、`build.rs` 拷贝逻辑、`tauri.conf.json` 资源 |
| Node 启动逻辑 | 已删除 runtime 解析、init data、supervisor、状态/重启/停止命令 |
| 扩展市场 | 已移除下载/市场视图注册与 SideX 容器搜索头，安装/搜索命令不再注册 |
| Node 扩展备份 | `extensions-node-disabled/` 仍在 git 中跟踪，暂保留，确认后再删除 |
| Rust 编译 | `cargo check` 通过（82 warning，均为既有未使用代码） |
| 前端构建 | `npm run build` 通过 |
| 运行验证 | `npm run tauri dev` 启动成功，扩展面板只剩 Rust 扩展与内置扩展 |

遗留清理：`tauriExtensionHost.contribution.ts` 中 Node WebSocket 桥接方法已不再连接，但死代码尚未删除，留待后续收口。
