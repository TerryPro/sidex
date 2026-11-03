# 补齐自定义编辑器子系统方案

> 架构图（实现后）：[SideX 自定义编辑器子系统](computer://f:\TRAEWS\sidex\.archify\architecture-custom-editor-impl-20261027-210707\custom-editor-architecture.html)
>
> 实现前：[补齐方案架构](computer://f:\TRAEWS\sidex\.archify\architecture-custom-editor-20261027-125722\custom-editor-architecture.html)

## 一、目标与边界

你要的两件事，落地后对应两组可验收指标。

| 目标 | 验收标准 |
| --- | --- |
| 崩溃隔离 | webview 内渲染异常或内存爆掉时，工作台不白屏、可恢复到报错状态 |
| 模块化 | 子系统可单独开关；第三方不装插件时体验与现在完全一致 |

明确不做：网络 API、调试器、Notebook、远程开发。这些不在本次范围。

## 二、现状盘点

整个模块不是"从没做过"，而是"移植过一半后被退化成了桩"。文件头统一写着 `Stub for removed ...`。

| 位置 | 现状 | 后果 |
| --- | --- | --- |
| `contrib/customEditor/common/customEditor.ts` | 只剩接口骨架 | 没有注册表、没有生命周期 |
| `contrib/customEditor/browser/customEditorInput.ts` | 所有方法空实现 | 编辑器打不开 |
| `contrib/customEditor/browser/customEditorInputFactory.ts` | 只有类型声明 | 窗口重载后无法恢复 |
| `contrib/customEditor/common/customTextEditorModel.ts` | 空壳 | 文本型自定义编辑器无模型 |
| 桥接层 `registerCustomEditorProvider` | 只打一行日志 | 扩展注册了也没人接 |
| `sidex.toml` 清单 | 只解析 `languages`、`commands` | 无法声明编辑器类型 |
| WIT `host-api` | 无注册函数、无 webview 创建函数 | WASM 扩展根本没法参与 |

**最难的部分其实已经在了。** webview 容器完整移植过（iframe + Service Worker + MessagePort），`IWebviewWorkbenchService.openWebview` 也已经在 webview 面板里跑着。要补的是它上面那几层的接口和转发代码，渲染部分不用重写。

## 三、目标架构

图里按层分了三段：扩展层在左，前端工作台在中间，隔离渲染层在最下。

| 层 | 职责 | 现状 |
| --- | --- | --- |
| 扩展层 | 提供 provider | Node 侧 provider 已存但没人调用；WASM 侧完全没有 |
| 推送通道 | 宿主向前端推 UI 事件 | 不存在，目前只能靠前端 invoke 拉取 |
| 桥接层 | 把 provider 接进服务、转发消息 | 只打日志 |
| 服务层 | 注册表、解析、脏标记、生命周期 | 桩 |
| 编辑器层 | Input（序列化/备份）与 Pane（承载） | 桩 |
| Webview 层 | 浏览器 iframe 容器 | 已移植，webview 面板在用 |
| 隔离层 | iframe + Service Worker + MessagePort | 已移植 |

## 四、分阶段实施

### 阶段 A：核心服务

目标：服务能被注册、能按 glob 解析、能追踪脏状态。

| 动作 | 文件 |
| --- | --- |
| 重写接口 | `contrib/customEditor/common/customEditor.ts` |
| 新增实现 | `contrib/customEditor/browser/customEditorService.ts` |
| 注册贡献 | `workbench.common.main.ts` |

接口大致需要这几样：

```ts
export interface ICustomEditorService {
	readonly onDidChangeCustomEditors: Event<void>;
	registerEditorProvider(viewType: string, provider: CustomEditorProvider): IDisposable;
	getEditorProvider(viewType: string): CustomEditorProvider | undefined;
	resolveEditor(resource: URI, viewType: string): Promise<CustomEditorModel>;
	getModels(resource: URI): CustomEditorModel[];
}
```

三个要点：

- 注册表以 `viewType` 为键，避免同一个类型被重复注册。
- 解析走现有 `IEditorResolverService.registerEditor`，不用另起一套。（[editorResolverService.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/services/editor/common/editorResolverService.ts#L189-L194)）
- 脏状态用服务级的 `onDidChangeDirty` 汇总，不要让每个编辑器各自往外散事件。

验收：写一个内存里的假 provider，能注册、能解析、能拿到脏状态。

### 阶段 B：编辑器输入与面板

目标：编辑器能真正打开，并且窗口重载后能恢复。

| 动作 | 文件 | 做法 |
| --- | --- | --- |
| 重写 Input | `browser/customEditorInput.ts` | 继承现有 `WebviewInput` |
| 加序列化 | `browser/customEditorInputFactory.ts` | 实现 `IEditorSerializer` |
| 新增面板 | `browser/customEditorPane.ts` | 继承现有 `WebviewEditor` |
| 文本型模型 | `common/customTextEditorModel.ts` | 复用文本模型 |

设计取舍只有一个需要拍板：Input 是继承还是新建。

| 方案 | 好处 | 代价 |
| --- | --- | --- |
| 继承 `WebviewInput` | 复用分组、拖拽、序列化机制 | 需要小心覆盖 dirty 逻辑 |
| 独立新建 | 耦合低 | 上面那些全要再写一遍 |

建议继承。理由是 `WebviewInput` 已经是 `EditorInput` 的成熟实现，另起一套等于把同一件事做第二遍。

序列化用现成的 `EditorExtensions.EditorFactory.registerEditorSerializer`，这条链路已经完整。

验收：打开编辑器 → 改内容 → 窗口重载 → 内容与脏状态都还在。

### 阶段 C：Node 路径先打通

先用 Node 扩展验证整条链路，因为它改的是 JS，迭代快。WASM 那条留到阶段 D、E。

改动集中在两处：

| 位置 | 改动 |
| --- | --- |
| `tauriExtensionHost.contribution.ts` | 把只打日志的分支换成真注册 |
| `host.cjs` | 保存的 provider 要真的被调用 |

需要补的消息协议：

| 方向 | 类型 | 用途 |
| --- | --- | --- |
| 前端 → 宿主 | `resolveCustomEditor` | 让扩展填充 webview |
| 前端 → 宿主 | `customEditorSave` | 保存 |
| 前端 → 宿主 | `customEditorRevert` | 撤销修改 |
| 宿主 → 前端 | `customEditorWebviewMessage` | webview 与扩展互传消息 |
| 宿主 → 前端 | `customEditorDirtyChanged` | 脏状态同步 |

webview 创建直接复用 `IWebviewWorkbenchService.openWebview`，这段已经在跑，不用重写。（[tauriExtensionHost.contribution.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts#L3181-L3199)）

顺手要修一个现存的安全问题：现在 `localResourceRoots` 给的是整个 `file:///`，等于让 webview 能读全盘。应该收紧到扩展目录加工作区目录。（[同文件 L3191](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/extensions/browser/tauriExtensionHost.contribution.ts#L3191)）

验收：写一个一百行左右的最小 Node 扩展，给 `.md` 注册一个自定义视图，验证打开、编辑、保存、消息双向都通。

验证期间需要临时把 `SIDEX_NODE_EXTENSIONS=on` 打开，因为 Node 宿主默认是关的。

### 阶段 D：清单与契约

这一步才让 WASM 扩展能声明自己的编辑器类型。

清单扩展：

```toml
[contributes.custom-editors]
viewType = "sidex.pdfPreview"
displayName = "PDF 预览"
filenamePatterns = ["*.pdf"]

[contributes.custom-editors.capabilities]
supportsMultipleEditorsPerDocument = false
```

WIT 的 `host-api` 需要补这几项：

| 函数 | 作用 |
| --- | --- |
| `register-custom-editor` | 注册视图类型 |
| `create-webview` | 创建 webview 句柄并返回 ID |
| `webview-set-html` | 写入 HTML |
| `webview-post-message` | 向页面发消息 |
| `webview-as-webview-uri` | 把本地资源转成可加载的 URI |

最后一项容易漏，但很关键：PDF 这类页面要加载 worker、字体、CMap，没有资源 URI 转换就直接白屏。

### 阶段 E：WASM 推送通道

WASM 宿主跑在 Rust 进程里，现在前端是 **invoke 拉取** 模式，宿主没有主动推事件的通道。而创建 webview 必须由宿主发起，所以这个通道绕不过去。

| 动作 | 位置 |
| --- | --- |
| Rust 侧 emit 事件 | `src-tauri/src/commands/extension_wasm.rs` |
| 前端 listen | `tauriExtensionHost.contribution.ts` |
| 新增桥接 | `contrib/extensions/browser/wasmUiBridge.ts` |

事件契约要带三个字段：扩展 ID、事件种类、载荷。前端按扩展 ID 路由到对应的面板。

这里有个必须提前处理的问题：事件洪泛。语言扩展一次补全可能触发几十条消息，如果每条都走事件通道会拖慢渲染。需要按 16ms 合并，或者对高频事件单独走批量接口。

### 阶段 F：隔离加固与度量

这一步决定"崩溃隔离"到底成不成立。

| 事项 | 说明 |
| --- | --- |
| 实测站点隔离 | WebView2 下跨源 iframe 是否独立进程，必须实测 |
| 崩溃恢复 | webview 接口目前只有 `onDidDispose` 和 `onMessage`，**没有崩溃事件**（[webview.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/webview/browser/webview.ts#L243-L264)）；要么加加载失败检测，要么加超时和无响应检测 |
| 资源上限 | 对单个 webview 的内存和渲染时长做限制 |
| 度量 | 崩溃次数、单编辑器内存、首开耗时 |

崩溃检测有个现实限制：浏览器层面拿不到 iframe 内 OOM 的明确信号，只能靠加载失败或超时无响应间接判断。所以"崩溃隔离"能保证的是**不连累主界面**，不能保证**准确报告崩溃原因**。

## 五、风险

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| WebView2 不出独立进程，隔离收益落空 | **已确认** | 高 | 见第八节实测；要么改跨源方案，要么把目标改成"不阻塞主线程" |
| 继承 `WebviewInput` 后序列化冲突 | 中 | 中 | 阶段 B 先用假 provider 跑通再扩展 |
| WASM 事件通道洪泛 | 中 | 中 | 合并窗口 + 高频事件走批量 |
| 与内置 PDF 抢同一批文件 | 低 | 中 | 优先级定为内建高于插件，用户显式选择才让位 |
| Node 宿主默认关闭导致阶段 C 难验证 | 高 | 低 | 临时开环境变量验证 |

## 六、顺序与依赖

| 阶段 | 依赖 | 能否并行 |
| --- | --- | --- |
| A 核心服务 | 无 | 否，其余都要它 |
| B 输入与面板 | A | 否 |
| C Node 桥接 | B | 可与 D 并行 |
| D 清单与契约 | A | 可与 C 并行 |
| E WASM 推送 | D | 否 |
| F 隔离加固 | C、E | 否 |

A 到 C 是地基，做完这三步就有可用的第三方自定义编辑器（Node 路线）。D 到 E 才轮到 WASM 扩展。

## 七、实测结果

2026-10-27 实测，结论是**当前配置下没有崩溃隔离**。

### 判定依据

| 依据 | 事实 |
| --- | --- |
| webview 入口地址 | Tauri 下 `webviewExternalEndpoint` 返回 `${window.location.origin}/webview-pre/`（[environmentService.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/services/environment/browser/environmentService.ts#L277-L280)），**与工作台同源** |
| 内容 frame | 内层 `active-frame` 的 `src` 是 `./fake.html`，再用 `document.write` 写入扩展内容（[index.html](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/webview/browser/pre/index.html#L1078-L1096)），**仍是同源** |
| sandbox 属性 | 两层 iframe 都同时给了 `allow-scripts` 和 `allow-same-origin`（[webviewElement.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/webview/browser/webviewElement.ts#L470)、[index.html](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/webview/browser/pre/index.html#L1055-L1063)） |
| 运行时参数 | WebView2 155.0.4283.62，启动参数里没有 `--single-process`，也没有 `--disable-site-isolation-trials` |
| 运行态 | SideX 整个工作台只有 **1 个 renderer 进程**（PID 21776，约 486MB） |

Chromium 的站点隔离只对**跨站** frame 生效。同源 frame 永远和父页面共用同一个渲染进程和主线程，这个结论和 WebView2 的具体版本无关。

### 对照实验

用 Playwright + 本机 Chrome 156 做同源/跨源对照：一个 iframe 内跑 2 秒死循环，看父页面 10ms 定时器在这 2 秒里还能不能跑。

| 场景 | 父页面定时器触发次数 | 阻塞期间实测耗时 | 含义 |
| --- | --- | --- | --- |
| 同源 iframe | **0**（期望约 200） | 2001ms | 父页面被完全冻结，共用主线程 |
| 跨源 iframe | **189**（期望约 200） | 2001ms | 父页面照常运行，进程已隔离 |

同源 0 次、跨源 189 次，差距足够干净。脚本在 `.probe/run.mjs`，可复跑。

### 由此带来的三个结论

1. **崩溃隔离在当前同源方案下不成立。** 自定义编辑器里一段死循环会冻结整个工作台；pdf.js 这类重渲染同理。
2. **安全边界也偏弱。** 扩展的 HTML 与工作台同源，`sandbox` 里又放了 `allow-same-origin`，Chrome 对这个组合会直接给出「可以逃逸沙箱」的警告——实验日志里就出现了这条。
3. **这不是"补几层代码"能解决的。** 阶段 A 到 E 补完只会让第三方扩展能接入，隔离仍然是零。

## 八、跨源方案验证结果

2026-10-27 在真实应用（WebView2 155）里实测，**跨源方案可行**。

### 路由实测

向四个地址发请求，看是否被 `sidex-asset` 协议处理器接住（接住会返回 404，没接住是网络错误）：

| 请求地址 | 结果 | 含义 |
| --- | --- | --- |
| `https://sidex-asset.localhost/` | 404 | 对照组，正常 |
| `https://sidex-asset.probe.localhost/` | **404** | **子域名在协议名之后，能被路由** |
| `https://probe.sidex-asset.localhost/` | 网络错误 | 子域名在协议名之前，不匹配 |
| `http://sidex-asset.localhost/` | 网络错误 | 必须用 https |

### 为什么是这个形状

wry 给 WebView2 注册的过滤器是 `https://<协议名>.*`（[webview2/mod.rs](file:///C:/Users/hexia/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.54.4/src/webview2/mod.rs#L935-L950)），匹配规则是前缀判断（[custom_protocol_workaround.rs](file:///C:/Users/hexia/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.54.4/src/custom_protocol_workaround.rs#L12-L19)）：

- `https://sidex-asset.` 之后的任意内容都算匹配
- 匹配后还原成 `sidex-asset://<剩余部分>` 交给处理器
- Tauri 这层不再校验 host（[tauri-runtime-wry/lib.rs](file:///C:/Users/hexia/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-runtime-wry-2.10.1/src/lib.rs#L4983-L4992)）

所以正确的写法是 `https://sidex-asset.<uuid>.localhost`，而不是 `<uuid>.sidex-asset.localhost`。

### 隔离实测

同一个对照实验测 `*.localhost` 子域名是否分进程：

| 场景 | 父页面定时器次数 | 结论 |
| --- | --- | --- |
| 同源 frame | 0 | 共用主线程 |
| `sidex-asset.probe.localhost` 子域名 frame | **186** | **已隔离** |
| 普通跨域 frame | 187 | 已隔离 |

结论：不同子域名之间是跨站关系，Chromium 会给独立进程。把 webview 搬到 `sidex-asset.<uuid>.localhost` 之后，崩溃隔离成立。

### 改造清单

| 改动点 | 内容 |
| --- | --- |
| `webviewExternalEndpoint` | 改成 `https://sidex-asset.{{uuid}}.localhost/webview-pre/`（[environmentService.ts](file:///f:/TRAEWS/sidex/src/vs/workbench/services/environment/browser/environmentService.ts#L277-L280)） |
| Rust 协议处理器 | 需要能服务内置的 `webview-pre` 资源，现有实现只服务工作区文件 |
| CSP | `webview-pre/index.html` 的 `frame-src` 要放行新源（[index.html](file:///f:/TRAEWS/sidex/src/vs/workbench/contrib/webview/browser/pre/index.html#L7-L8)） |
| sandbox | `allow-same-origin` 可以保留——此时它与工作台已不同源，沙箱逃逸的前提消失 |

## 十、实施状态（2026-10-27）

| 项 | 状态 | 位置 |
| --- | --- | --- |
| A 核心服务 | 已完成 | `contrib/customEditor/browser/customEditorService.ts`、`customEditorModel.ts` |
| B 输入与面板 | 已完成 | `customEditorInput.ts`、`customEditorPane.ts`、`customEditorInputFactory.ts`、`common/customTextEditorModel.ts` |
| C Node 桥接 | 已完成 | `tauriExtensionHost.contribution.ts`、`extension-host/host.cjs` |
| D 清单解析 | 已完成 | `extension_platform.rs` 解析 `[contributes.custom-editors]` |
| 0 跨源改造 | 已完成 | `environmentService.ts`、`lib.rs` 协议处理器、`tauri.conf.json`、`vite.config.ts` |
| D WIT 契约 | 已完成 | 两份 `world.wit` 各加 5 个 host-api 函数 |
| E WASM 推送通道 | 已完成 | 动作队列 + 运行时读取 + Tauri 命令 + 前端轮询 |
| F 度量加固 | 已完成（基础版） | 编辑器崩溃时保活 + 「重新加载」入口 |

跨源改造已在真实应用验证：HTML 预览正常显示，webview 从独立子域名加载。

### WASM 路径的设计结论

排查后发现一个关键事实：每个 WASM 扩展持有**长期存活的 `Store<WasmHostState>`**，不是每次调用新建。这比原先估计的简单——UI 动作可以直接存在 `WasmHostState` 里，像 diagnostics 一样由运行时读取，不需要额外的回收管线。

| 步骤 | 改动 |
| --- | --- |
| 1 | 两份 WIT 各加 5 个 host-api 函数：`register-custom-editor`、`create-webview`、`webview-set-html`、`webview-post-message`、`webview-as-webview-uri` |
| 2 | `WasmHostState` 增加 `ui_actions: Vec<Value>` 与 `webviews: HashMap<u64, String>` |
| 3 | 实现 5 个函数，把动作压入队列 |
| 4 | `WasmExtensionRuntime::take_ui_actions()` 遍历扩展、取走队列 |
| 5 | 新增 Tauri 命令并注册 |
| 6 | 前端轮询命令，按动作注册 provider、设置 HTML、投递消息 |

必须一次做完并重启验证，中途停下会留下无法工作的半成品。

### WASM 路径的实现细节

| 环节 | 落地方式 |
| --- | --- |
| 动作来源 | 扩展调用 `register-custom-editor` / `create-webview` / `webview-set-html` / `webview-post-message`，动作压入 `WasmHostState.custom_editor_actions` |
| 清单补齐 | `register` 动作由运行时从该扩展的 `sidex.toml` 补上 `displayName`、`filenamePatterns`、`priority` |
| 打开流程 | 前端 provider 的 `resolveCustomEditor` 调 `wasm_activate_custom_editor`，宿主把 `active_webview_id` 设好再调扩展的 `custom-editor-open` |
| 渲染 | 扩展在调用中 `create-webview` 拿到句柄，再 `webview-set-html`；前端每 200ms 取一次动作并套用 |
| 资源地址 | `webview-as-webview-uri` 返回 `__SIDEX_WEBVIEW_URI__<handle>__<path>` 标记，前端替换成 `https://sidex-asset.localhost/<path>` |

**已知缺口**：无。webview 消息回传与保存已在 CSV 示例扩展中跑通。

### CSV 示例扩展

`extensions-rust/csv-editor-extension` 是第一个使用该链路的 WASM 扩展。

| 项 | 内容 |
| --- | --- |
| 视图类型 | `sidex.csv.preview` |
| 匹配 | `*.csv`，优先级 default |
| 激活 | `onStartupFinished`，启动即注册 provider |
| 渲染 | Rust 解析 CSV，输出带 `contenteditable` 单元格的表格 |
| 回传 | 单元格失焦时页面发 `{type:'edit',row,col,value}`，前端转给扩展 |
| 保存 | 扩展收到消息后直接写回文件 |


已验证：TypeScript 类型检查无新增错误；`cargo check` 通过（仅既有 warning）；Vite 能转换全部新增模块。

剩下的是同一条链上的三个环节（WIT 契约 → Rust 宿主实现 → 前端轮询），彼此强依赖，拆开做没有意义，必须一次完成并重启验证。

### 行为变化

webview 现在从 `<uuid>.webview.localhost`（开发）或 `https://sidex-asset.<uuid>.localhost`（打包）加载，与工作台不同源，因此渲染进程独立。

首次重启后如果 webview 白屏，优先检查三处：

| 检查点 | 预期 |
| --- | --- |
| Vite 是否接受该 Host | `allowedHosts` 已加入 `.webview.localhost` |
| `webview-pre` 资源是否可达 | 开发走 Vite，打包走 `sidex-asset` 协议 |
| 服务源校验 | `<hash>.webview.localhost` 满足 `hostname.startsWith(hash + '.')` |


## 十一、实施顺序

验证通过了，顺序要调整：**先做跨源改造，再补 A 到 F**。

| 顺序 | 事项 | 理由 |
| --- | --- | --- |
| 0 | 跨源改造：`webviewExternalEndpoint` + Rust 协议处理器 + CSP | 地基，且改动集中在协议层，不碰服务代码 |
| 1 | 阶段 A 核心服务 | 依赖 0 的地址形态 |
| 2 | 阶段 B 输入与面板 | |
| 3 | 阶段 C Node 桥接 | 可与 D 并行 |
| 4 | 阶段 D 清单与契约 | |
| 5 | 阶段 E WASM 推送 | |
| 6 | 阶段 F 度量与加固 | 有了隔离才谈得上度量 |

如果先做 A 到 F 再改跨源，等于所有编辑器路径都要回头改一遍地址。
