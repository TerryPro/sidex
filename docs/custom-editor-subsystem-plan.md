# 补齐自定义编辑器子系统方案

> 架构图：[SideX 自定义编辑器子系统补齐架构](computer://f:\TRAEWS\sidex\.archify\architecture-custom-editor-20261027-125722\custom-editor-architecture.html)

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
| WebView2 不出独立进程，隔离收益落空 | 中 | 高 | 先做实测，再决定投不投 E |
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

## 七、建议的第一步

在做 A 之前，先花很小代价验证一件事：**在你这套 webview 里加载 pdf.js，看它到底有没有独立进程**。

这个结论决定整个方案的收益。如果 WebView2 给独立进程，那崩溃隔离成立，值得按 A 到 F 顺序推进；如果做不到，那"崩溃隔离"这个目标要重新定义为"渲染不阻塞主线程"，方案的重心就得往性能和模块化偏，而不是隔离。

需要的话，我可以先把这步验证写成可运行的检查清单。
