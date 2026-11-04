# 12 浏览器视图 browserView 移除

| 字段 | 内容 |
| --- | --- |
| Issue 编号 | SIDEX-TRIM-012 |
| 优先级 | P1 |
| 状态 | 已完成（2026-11-04） |
| 来源 | [功能裁剪复核](../file-manager-editor-spec.md) 5.3 P1 |
| 依赖 | SIDEX-TRIM-008 |

## 背景

`browserView` 提供内嵌浏览器编辑器与「在集成浏览器中打开」命令。文件浏览器产品只需 HTML 预览，不需要完整浏览器视图与页面权限面。

## 执行结果（2026-11-04）

| 项目 | 实际改动 |
| --- | --- |
| 浏览器编辑器 | `src/vs/workbench/contrib/browserView/` 已删除 |
| 扩展 API | `mainThreadBrowsers.ts`、`extHostBrowsers.ts` 已删除，协议 Shape 与代理标识清理 |
| 平台服务 | `src/vs/platform/browserView/` 已删除，CDP、Playwright 服务移除 |
| 命令与菜单 | 「在集成浏览器中打开」命令与菜单项已删除 |
| HTML 预览 | `contrib/htmlPreview/` 使用普通 webview/只读渲染，不再依赖 browserView |
| 外部打开 | 保留 `opener`、`url` 与外部浏览器打开链接能力 |

## 原始实施清单

- [x] 删除 `contrib/browserView/` 目录与相关 import。
- [x] 删除 `mainThreadBrowsers.ts`、`extHostBrowsers.ts` 与协议中的浏览器 Shape/代理标识。
- [x] 从 `extHost.api.impl.ts` 删除 `ExtHostBrowsers` 注册与命名空间。
- [x] 删除 `src/vs/platform/browserView/` 中不再使用的 CDP 服务。
- [x] 删除「在集成浏览器中打开」命令与菜单项。
- [x] 检查 `htmlPreview` 不依赖 browserView。
- [x] 全仓搜索 `browserView`、`BrowserEditor`、`openInBrowser`、`ExtHostBrowsers`，无 UI/命令残留。

## 验收结果

| 验收项 | 结果 |
| --- | --- |
| 命令面板「浏览器」 | 无集成浏览器入口 |
| HTML 文件预览 | 正常 |
| `npx tsc --noEmit` / `npm run build` | 通过 |
| CDP/浏览器进程 | 无 |
