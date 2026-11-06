# 11: Problems 面板移除或重构

**What to build:** 无语言诊断来源后，不再展示空的 Problems 面板；保留输出/日志入口，避免用户误以为诊断功能损坏。

**Blocked by:** 01 收口扩展清理与绿色基线

**Status:** done

- [x] 默认布局与菜单不再出现 Problems 入口
- [x] 输出/日志仍可用
- [x] 旧面板状态不会在重启后恢复
- [x] 相关贡献与命令清理完毕，无死代码

## Comments

- 2026-11-06：移除整个 `contrib/markers` 面板实现（视图容器、视图、状态栏条目、活动栏徽章、过滤器与相关命令），不再注册 `workbench.actions.view.problems` / `workbench.action.problems.focus`，`Ctrl+Shift+M` 随命令一并失效。
- 原生菜单：删除 Tauri View 菜单的 Problems 项（`src-tauri/src/lib.rs`）与 `src/main.ts` 的 `problems` 命令映射；Output 项保留。
- 配置：删除 `problems.visibility` 设置与 `problemsConfigurationNodeBase`，并清理编辑器配置变更判断中的引用。
- 布局状态：面板恢复时按已注册视图容器校验，`workbench.panel.markers` 已不存在，旧状态会回退到 Output；`workbench.panelpart.activepanelid` 中的旧值不会重新打开 Problems。
- 输出面板：`outputView` 不再借用 markers 的 Memento id，改用 `workbench.panel.output`（首次升级会重置一次输出过滤器状态）。
- 保留 `platform/markers` 与语言服务诊断：编辑器波浪线、跳转错误等仍可用，只删除了面板 UI。
- 验证：`npx tsc --noEmit`、`npm run build`、`cargo check` 通过；`npm run tauri dev` 启动冒烟通过（workbench ready 1543ms，无前端报错）。
