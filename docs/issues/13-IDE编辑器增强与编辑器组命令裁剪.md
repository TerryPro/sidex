# 13 IDE 编辑器增强与编辑器组命令裁剪

| 字段 | 内容 |
| --- | --- |
| Issue 编号 | SIDEX-TRIM-013 |
| 优先级 | P2 |
| 状态 | 已完成（2026-11-04） |
| 来源 | [功能裁剪复核](../file-manager-editor-spec.md) 5.3 P2 |
| 依赖 | 无 |

## 背景

编辑器仍默认开启代码透镜、内联提示、内联补全、参数提示、粘性滚动、小地图、面包屑等专业 IDE 功能；命令面板也有「合并所有编辑器组」等布局命令。

## 执行结果（2026-11-04）

| 项目 | 实际改动 |
| --- | --- |
| 默认关闭 | `editor.codeLens`、`editor.inlayHints.enabled`、`editor.parameterHints.enabled`、`editor.stickyScroll.enabled`、`editor.minimap.enabled`、`editor.colorDecorators` 默认 `false` |
| 内联补全 | `editor.inlineSuggest.enabled` 默认 `false` |
| 面包屑 | `breadcrumbs.enabled` 默认 `false` |
| 编辑器组命令 | 删除 `JoinTwoGroupsAction`、`JoinAllGroupsAction` 注册与菜单 |
| 保留 | `editor.guides.bracketPairs`、多光标、查找替换、格式化、折叠、括号匹配、自动保存 |

## 原始实施清单

- [x] 在用户默认配置中关闭 codelens、inlayHints、inlineCompletions、parameterHints、stickyScroll、minimap、breadcrumbs、colorDecorators。
- [x] 保留 `editor.guides.bracketPairs` 等基础对齐辅助。
- [x] 删除 `workbench.action.joinTwoGroups`、`workbench.action.joinAllGroups` 及相关菜单/快捷键。
- [x] 分屏命令保留编辑器拆分基础能力，不暴露合并组命令。
- [x] 扩展无法强制开启默认关闭项；保留开关。
- [x] 更新 `defaults.rs` 默认值并补充测试。

## 验收结果

| 验收项 | 结果 |
| --- | --- |
| 默认打开文本文件 | 无代码透镜、内联提示、参数提示、粘性滚动、小地图、面包屑 |
| 命令面板「合并」「Join」 | 无编辑器组命令 |
| 查找替换、格式化、折叠、多光标 | 正常 |
| `npx tsc --noEmit` / `npm run build` | 通过 |
