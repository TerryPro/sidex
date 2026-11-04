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
| 其他能力 | 预览、自定义编辑器保留；Git/源代码管理/时间线已移除；终端是否保留见第五节 |
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
| 3 | 多根 LSP、扩展沙箱、终端/搜索隔离 | 多目录同时打开语言能力正常 |
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

## 五、功能裁剪复核（2026-11-04）

> 目标：只保留「浏览文件 → 打开文件 → 编辑文本 → 预览内容 → 查找/替换」主链路。凡依赖项目模型、调试、任务编排、云端账号、团队协作的能力，一律裁剪。
>
> 裁剪必须三层同时清理：界面入口（活动栏/面板/菜单）→ 命令、快捷键、配置、状态栏 → 代码、Rust 命令与依赖、扩展 API 类型。只删界面会留下「能搜到但点了没反应」的残留。

### 5.1 已完成裁剪

| 项 | 结果 |
| --- | --- |
| Git / 源代码管理 / 时间线 | 界面、菜单、命令、配置、快捷键、扩展协议与 API、Rust `sidex-git`、原生菜单项均已删除；仅保留编辑器 Quick Diff 服务层 |
| Node 扩展宿主 | `ext_host.rs`、`extension-host/`、runtime 解析、supervisor 已删除 |
| 扩展市场面板 | 下载/市场视图与安装命令已移除；仍有「颜色主题市场」「检查扩展更新」命令残留，见 5.2 |
| 调试 / 任务 / 测试 / 笔记本 / 评论 / 账户 | 命令面板实测均无入口，只剩代码与扩展 API 类型 |

### 5.2 当前仍可见的 IDE 入口（命令面板实测）

| 搜索词 | 实测结果 | 结论 |
| --- | --- | --- |
| 调试、任务、测试、笔记本、评论、账户、代码透镜、内联提示 | 没有匹配 | 界面已无入口，可删代码 |
| 远程 | 「远程资源管理器」 | 需裁剪 |
| 工作区 | 「在新建的空白工作区中打开活动编辑器」等 | 需裁剪或改名 |
| 同步 | 「清除云数据并停止同步」类命令 | 需裁剪 |
| 搜索编辑器 | 「搜索编辑器」 | 需裁剪；活动栏搜索项也误显示为「搜索编辑器」 |
| 市场/扩展更新 | 「在市场浏览颜色主题」「检查扩展更新」「显示扩展更新」 | 需收口 |
| 终端 | 切换、新建、拆分终端 | 待决策，见 5.3 |

### 5.3 建议裁剪清单

#### P0：零/低风险，优先做完

| 项 | 现状 | 动作 |
| --- | --- | --- |
| 原生菜单残留 | Source Control 项与 Ctrl+Shift+G 已删除；`src/main.ts` 的 `mRun` 仍指向不存在的 `run_menu`，nls 文案表仍有 Run/Debug/Task；File 菜单有 New Window | 删除 run/debug/task 文案映射；删除 New Window（单窗口） |
| 搜索编辑器 | `contrib/searchEditor` 已注册 | 删除 Search Editor 编辑器、命令与序列化器；活动栏恢复为「搜索」 |
| 远程入口 | `contrib/remote` + 命令面板「远程资源管理器」 | 先隐藏容器与命令，P1 整体删除 |
| 工作区命令 | 「在新建的空白工作区中打开…」等 | 先从菜单与命令面板移除，P1 删除服务 |
| 设置同步 | 命令面板仍出现同步/清除云数据命令 | 删除命令、状态栏与账户入口 |
| 市场与扩展更新 | 颜色主题市场、扩展检查更新 | 删除市场命令与扩展更新视图 |
| 活动栏末位按钮 | 显示「管理授权扩展 URI...」 | 移除，或替换为「设置」 |
| 未注册的 IDE 目录 | `contrib/notebook`、`comments`、`interactive`、`mergeEditor`、`multiDiffEditor`、`issue` 仍被 API 层引用 | 先删扩展 API（comments/notebook/interactive/merge/multiDiff），再删 UI 目录 |

#### P1：需要配套改造

| 项 | 涉及 | 动作 |
| --- | --- | --- |
| 远程开发 | `contrib/remote`、`crates/sidex-remote`、`commands/remote.rs`、`remoteTunnel`/`tunnel`、SSH/WSL/容器/Codespaces 命令与依赖 | 整体删除远程容器、命令、Rust 命令与 crate；保留本地 `opener`/`url` |
| 工作区/项目语义 | `contrib/workspaces`、`services/workspaces`、`.code-workspace`、Workspace Trust、多根工作区 | 删除打开/保存工作区、工作区编辑、信任域；`IWorkspaceContextService` 仅保留「已打开目录集合」内部语义 |
| 终端（待决策） | `contrib/terminal`、`contrib/terminalContrib`、`crates/sidex-terminal`、`commands/terminal.rs` | 方案 A 整体删除；方案 B 只保留新建/切换/关闭/复制粘贴，删除 shell integration、typeAhead、sticky scroll、links、suggest、quickFix、command guide、WSL recommendation、notification、sendSequence/sendSignal、autoReplies |
| 配置档案 Profiles | `crates/sidex-profiles`、`commands/profiles.rs`、`services/userDataProfile` UI | 只保留单一用户配置，删除档案切换/创建/关联 UI 与命令 |
| 自动更新 | `contrib/sidexUpdate`、`crates/sidex-update`、`commands/updater.rs` | 不发布自动更新则整项删除；保留则只留「检查更新 + 手动安装」 |
| 浏览器视图 browserView | `contrib/browserView`、`mainThreadBrowsers`、HTML 预览的「在集成浏览器中打开」 | 若只需 HTML 预览，删除 browserView API，保留预览编辑器 |

#### P2：编辑器瘦身（优先用默认值关闭，再考虑删代码）

| 项 | 建议 |
| --- | --- |
| 代码透镜、内联提示、内联补全、参数提示、颜色装饰、粘性滚动、小地图、面包屑 | 默认全部关闭；确认无扩展使用后再删 contribution 与 API |
| callHierarchy / typeHierarchy | 只保留「转到定义/引用」，删除调用层次与类型层次 API |
| 代码片段 / Emmet | 代码片段保留（成本低、对编辑有用）；Emmet 未注册，确认后删 |
| 编辑器组命令 | 只保留关闭/切换，删除「合并所有编辑器组」「将组与下一组合并」等布局命令 |
| 设置项 | `crates/sidex-settings` 现有 350+ 默认项，按文件/编辑器/主题/键位/扩展五组重写，隐藏 IDE 组；每裁一项同步删默认值与 schema |
| 扩展 API 面 | `vscode.d.ts` 与 `extHost.protocol.ts` 删除 comments、notebook、interactive、merge、multiDiff、tests、tasks、debug、chat、browserView 类型 |

### 5.4 必须保留（裁剪红线）

| 能力 | 原因 |
| --- | --- |
| 文件浏览 | 此电脑、驱动器、目录标签、文件列表、地址栏、前进/后退 |
| 文件操作 | 新建、重命名、复制/移动、回收站删除、拖放、冲突处理、撤销 |
| 编辑核心 | Monaco 文本编辑、多光标、查找替换、格式化、折叠、自动保存/热退出 |
| 语言能力 | LSP + Rust/WASM 扩展：诊断、悬停、定义、引用、重命名、大纲、符号 |
| 预览 | 图片、PDF、HTML、Markdown、Mermaid、自定义编辑器 |
| 辅助面板 | 搜索面板、问题、输出、大纲（Search Editor 除外） |
| 个性化 | 主题、键位、设置、最近目录/收藏 |
| Quick Diff | 编辑器 diff 装饰，已保留最小服务层 |

### 5.5 与现有规格的冲突修正

| 位置 | 原文/现状 | 修正 |
| --- | --- | --- |
| 1.5 编辑与扩展 | 「Git、终端、预览、自定义编辑器保留」 | 已改为 Git 已移除、终端待决策 |
| 2.1 DirectoryContext | 含 `scm` 字段 | 已删除 |
| 2.2 关键改造点 | 含 Git 行 | 已删除 |
| 3 实施阶段 | 阶段 3「终端/搜索/Git 隔离」 | 已改为「终端/搜索隔离」 |
| 1.2 界面形态 | 仅单窗口 | 原生菜单 New Window 需在 P0 删除 |

### 5.6 建议执行顺序

| 顺序 | 内容 | 验收 |
| --- | --- | --- |
| 1 | P0 菜单/命令/活动栏残留 | 命令面板搜远程/工作区/同步/市场/搜索编辑器均无结果；原生菜单无 Source Control、无 New Window |
| 2 | P1 远程、工作区、终端、Profiles、自动更新、browserView | `cargo check` 与 `npm run build` 通过；命令面板无残留 |
| 3 | P0/P2 扩展 API 与未注册目录 | `vscode.d.ts`、`extHost.protocol.ts` 无 IDE 类型；打包体积下降 |
| 4 | P2 设置与编辑器默认值 | 设置面板默认只显示五组；IDE 增强默认关闭 |

### 5.7 Issue 拆分

裁剪计划已拆成 15 个可独立执行的 Issue，统一编号为 `SIDEX-TRIM-001` ~ `SIDEX-TRIM-015`。

- 总览与执行顺序：[功能裁剪 Issue 总览](issues/00-功能裁剪Issue总览.md)
- 文档目录：`docs/issues/`，文件名前缀与编号对应（如 `01-原生菜单与失效映射清理.md`）
- 建议顺序：P0（001、002、006、007）→ P1（003、004、005、009、010、011、012）→ P0/P2（008）→ P2（013、014）→ 收口（015）
- 执行结果（2026-11-04）：001~015 全部完成；008 中 notebook 协议仅保留类型占位，014 默认值降至 328 项。


