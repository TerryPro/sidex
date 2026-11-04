# 10 配置档案 Profiles 移除

| 字段 | 内容 |
| --- | --- |
| Issue 编号 | SIDEX-TRIM-010 |
| 优先级 | P1 |
| 状态 | 已完成（2026-11-04）：UI/设置入口已移除，默认 profile 存储保留 |
| 来源 | [功能裁剪复核](../file-manager-editor-spec.md) 5.3 P1 |
| 依赖 | SIDEX-TRIM-007 |

## 背景

配置档案（Profiles）允许创建多套设置、扩展、键位组合，是 IDE 的多环境能力。产品决策是「仅用户级设置」，不需要档案切换，也不需要活动栏上的 Profile 徽标。

## 执行结果（2026-11-04）

| 项目 | 实际改动 |
| --- | --- |
| Activity Bar | `GlobalActivityActionViewItem` 固定齿轮图标，不再显示 Profile 图标/徽标 |
| 设置界面 | 移除档案切换、创建、关联入口 |
| 命令面板 | 移除 `createProfile`、`switchProfile`、`deleteProfile` 等用户命令 |
| 窗口设置 | 移除 Profile 相关窗口选项 |
| 保留 | `crates/sidex-profiles` 与 `commands/profiles.rs` 保留，用于单一默认用户配置的读写 |
| 保留 | `userDataProfile` 内部服务保留，供设置、键位、扩展管理使用 |

## 原始实施清单

- [ ] 删除 `crates/sidex-profiles/` — **未执行，保留为默认 profile 存储**
- [ ] 删除 `profiles.rs` 与 `profiles_*` 命令 — **未执行，保留内部默认配置读写**
- [x] 移除 `workbench.web.main.ts` 中档案切换相关注册。
- [x] 删除设置界面中的档案入口与档案管理命令。
- [x] `GlobalActivityActionViewItem` 改为固定齿轮图标，不再读取 `currentProfile.icon`。
- [x] 删除档案相关用户设置项。
- [x] 全仓搜索 `userDataProfile`、`profiles_`、`createProfile`、`switchProfile`，仅保留内部服务。

## 验收结果

| 验收项 | 结果 |
| --- | --- |
| 命令面板「配置文件/档案」 | 无用户入口 |
| 活动栏齿轮按钮 | 无 Profile 徽标 |
| 设置页 | 只有单一用户设置 |
| `cargo check` / `npx tsc --noEmit` / `npm run build` | 通过 |
