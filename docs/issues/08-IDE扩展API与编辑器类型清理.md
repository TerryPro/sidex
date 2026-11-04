# 08 IDE 扩展 API 与编辑器类型清理

| 字段 | 内容 |
| --- | --- |
| Issue 编号 | SIDEX-TRIM-008 |
| 优先级 | P0（API 入口）→ P2（目录删除） |
| 状态 | 已完成（2026-11-04） |
| 来源 | [功能裁剪复核](../file-manager-editor-spec.md) 5.3 P0/P2 |
| 依赖 | 无 |

## 背景

调试、任务、测试、评论、笔记本等 UI 已不再注册，但扩展 API 层仍保留对应类型与编辑器输入；`contrib/notebook`、`contrib/comments`、`contrib/interactive`、`contrib/mergeEditor`、`contrib/multiDiffEditor` 等目录因此无法删除。

## 目标

- 删除评论、调用层次、类型层次等 IDE 专属扩展 API 命名空间、协议 Shape 与 `vscode.d.ts` 类型。
- 删除对应的编辑器输入类型与 UI 目录。
- 保留 Monaco 核心编辑、LSP 基础能力（诊断、悬停、定义、引用、重命名、大纲、符号）。

## 实施结果

### 评论 API 与 UI（已删除）

| 位置 | 处理 |
| --- | --- |
| `api/common/extHostComments.ts` | 文件已删除 |
| `api/browser/mainThreadComments.ts` | 文件已删除 |
| `contrib/comments/` | 目录已删除 |
| `api/common/extHost.api.impl.ts` | 移除 `comments` 命名空间与 5 个评论枚举导出 |
| `api/common/extHost.protocol.ts` | 移除 `MainThreadCommentsShape`、`ExtHostCommentsShape`、`CommentProviderFeatures`、`CommentChanges`、`CommentThreadChanges` 与 `MainContext.MainThreadComments` 代理 |
| `api/browser/extensionHost.contribution.ts` | 移除 `mainThreadComments` import |
| `api/common/extHostTypes.ts` | 移除 `CommentThreadCollapsibleState`、`CommentMode`、`CommentState`、`CommentThreadState`、`CommentThreadApplicability`、`CommentThreadFocus` |
| `vscode-dts/vscode.d.ts` | 移除 `CommentThread`、`Comment`、`CommentController`、`comments` 命名空间等全部评论类型 |
| `platform/actions/common/actions.ts` | 移除 9 个评论菜单 MenuId |
| `services/actions/common/menusExtensionPoint.ts` | 移除 9 个评论菜单贡献点 |
| `platform/extensions/common/extensionsApiProposals.ts` | 移除 `activeComment`、`commentsDraftState`、`commentReactor`、`commentReveal`、`commentThreadApplicability`、`commentingRangeHint`、`contribComment*` 等 9 个提案 |
| `base/common/marshallingIds.ts` | 移除评论相关序列化 ID |
| `workbench/common/comments.ts` | 文件已删除 |

### 调用层次 / 类型层次（已删除）

| 位置 | 处理 |
| --- | --- |
| `contrib/callHierarchy/`、`contrib/typeHierarchy/` | 目录已删除 |
| `api/common/extHost.protocol.ts` | 移除 `ICallHierarchyItemDto`、`IIncomingCallDto`、`IOutgoingCallDto`、`ITypeHierarchyItemDto` 与 8 个 Provider 方法 |
| `api/common/extHostLanguageFeatures.ts` | 移除 `CallHierarchyAdapter`、`TypeHierarchyAdapter` 及注册方法 |
| `api/browser/mainThreadLanguageFeatures.ts` | 移除 Provider 注册与 DTO 复活方法 |
| `api/common/extHostTypeConverters.ts` | 移除 4 个层次结构转换器 |
| `api/common/extHostCommands.ts` / `extHostApiCommands.ts` | 移除 6 个层次结构命令 |
| `api/common/extHostTypes.ts` | 移除 `CallHierarchy*`、`TypeHierarchyItem` |
| `api/common/extHost.api.impl.ts` | 移除 `registerCallHierarchyProvider`、`registerTypeHierarchyProvider` 与 4 个类型导出 |
| `vscode-dts/vscode.d.ts` | 移除 `CallHierarchy*`、`TypeHierarchy*`、两个 Provider 与两个注册函数 |

### 编辑器标签输入类型（已删除）

| 位置 | 处理 |
| --- | --- |
| `contrib/interactive/`、`contrib/mergeEditor/`、`contrib/multiDiffEditor/` | 目录已删除 |
| `api/common/extHost.protocol.ts` | `TabInputKind` 仅保留文本、文本差异、自定义、Webview、终端；删除 5 个对应 DTO 与联合类型成员 |
| `api/common/extHostEditorTabs.ts` | 移除 5 种输入转换分支 |
| `api/common/extHostTypes.ts` | 移除 `TextMergeTabInput`、`NotebookEditorTabInput`、`NotebookDiffEditorTabInput`、`InteractiveWindowInput`、`TextMultiDiffTabInput` |
| `api/browser/mainThreadEditorTabs.ts` | 移除对应编辑器输入分支与 MultiDiff 监听器 |
| `vscode-dts/vscode.d.ts` | 移除 `TabInputNotebook`、`TabInputNotebookDiff` |
| `vscode-dts/vscode.proposed.tabInputTextMerge.d.ts`、`tabInputMultiDiff.d.ts` | 文件已删除 |

### 菜单与编辑器入口残留（已清理）

| 位置 | 处理 |
| --- | --- |
| `services/actions/common/menusExtensionPoint.ts` | 移除 debug、notebook、interactive、testing、issue、远程指示器菜单贡献点 |
| `platform/actions/common/actions.ts` | 删除上述菜单对应的 MenuId 常量 |
| `browser/parts/editor/breadcrumbsControl.ts` | 移除面包屑开关中的 notebook 菜单引用 |
| `api/common/extHost.protocol.ts` | 移除 `MainThreadInteractiveShape`、`ExtHostInteractiveShape` 与代理标识 |

## 保留项与原因

| 位置 | 保留原因 |
| --- | --- |
| `api/common/extHost.protocol.ts` 中的 Notebook Shape | 纯类型声明，运行期无 `MainThreadNotebook` / `ExtHostNotebook` 注册；被批量编辑、搜索的 notebook 分支引用 |
| `contrib/notebook/common/*` | 约 20 KB 的类型占位，供扩展 API 转换器、搜索与批量编辑共用 |
| `vscode-dts/vscode.d.ts` 的 notebook / debug / tasks / tests 命名空间 | 仅类型声明，不进入打包产物；第三方扩展安装时仍需类型可解析 |

上述保留项不影响启动路径与打包体积。

## 验收标准

- [x] `vscode.d.ts` 不再包含 comments、callHierarchy、typeHierarchy、Notebook TabInput 类型。
- [x] `extHost.protocol.ts` 不再包含评论与层次结构 Shape。
- [x] `contrib/comments/`、`contrib/callHierarchy/`、`contrib/typeHierarchy/`、`contrib/interactive/`、`contrib/mergeEditor/`、`contrib/multiDiffEditor/` 已删除。
- [x] `npx tsc --noEmit` 通过。
- [x] `npm run build` 通过，JS 体积 17.70 MB（nls.js 5.83 MB）。
- [x] `cargo check -p sidex` 通过。

## 风险

中。协议、API、编辑器注册相互耦合；本次按「API → 类型 → 目录」顺序清理，并在每一步执行 `npx tsc --noEmit` 验证。
