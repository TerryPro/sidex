<h1 align="center">SideX</h1>

<p align="center">
  <strong>一个内嵌代码编辑器的 Windows 文件管理器。</strong>
</p>

<p align="center">
  <a href="https://discord.gg/8CUCnEAC4J"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/Sidenai/sidex/issues"><img src="https://img.shields.io/badge/Contributing-Welcome-brightgreen?style=for-the-badge" alt="Contributing"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Built_with-Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Built with Tauri">
</p>

<br>

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="SideX —— 运行在 Tauri 上的文件管理器与编辑器" width="900">
</p>

<br>

<p align="center">
  <a href="#为什么">为什么</a> · <a href="#已实现的能力">已实现的能力</a> · <a href="#尚未实现的能力">尚未实现的能力</a> · <a href="#快速开始">快速开始</a> · <a href="#实现方式">实现方式</a> · <a href="#参与贡献">参与贡献</a> · <a href="https://discord.gg/8CUCnEAC4J">Discord</a>
</p>

---

SideX 是一个「顺手带了编辑器」的 Windows 文件管理器。它浏览你的磁盘和目录、不打开文件就能预览内容，而真正需要修改的文件则在 Monaco 编辑器中打开——全部在一个原生窗口内完成，后端由 Rust 驱动，而不是自带一套浏览器。

界面外壳移植自 Visual Studio Code 的 workbench，这也是编辑器、面板和快捷键手感熟悉的来源。SideX 砍掉的是文件管理器用不到的一切：没有 Git 集成，没有扩展市场，没有语言服务器，没有账号，没有遥测。

> **早期版本。** 文件浏览、编辑和终端已经可用；文件**管理**（重命名、删除、回收站、拖放）仍在建设中——完整清单见 [尚未实现的能力](#尚未实现的能力)。

---

## 为什么

VS Code 的内存开销主要来自它自带的 Chromium，而非编辑器本身。Tauri 把它替换成系统上已经装好的 WebView（Windows 上是 WebView2），于是复用你已经在运行的浏览器，而不是再启动一个。

<p align="center">
  <img src="./docs/assets/compare.jpg" alt="SideX 与 Visual Studio Code 的内存占用对比" width="760">
</p>

图中数字是宣传口径，但 WebView2 的实际内存随测量方式和打开的面板变化很大。请把它当作数量级参考，而不是承诺。

---

## 已实现的能力

**文件浏览**

- 驱动器列表，带卷标、容量与剩余空间（Windows）
- 文件夹树导航，展开状态按标签独立保存
- 文件列表展示名称、修改日期、类型、大小四列；文件夹优先，按名称排序
- 地址栏支持后退 / 前进 / 向上 / 刷新，以及面包屑路径
- 单击文件在侧栏预览——图片直接渲染，文本文件显示内容，文件夹和其他类型显示占位提示
- 双击在编辑器中打开文件，或进入文件夹
- 多个目录标签，各自拥有独立的导航历史与打开文件集合

**编辑**

- Monaco 编辑器：多光标、查找替换、折叠、撤销重做、自动保存
- 基于 TextMate 语法的语法高亮
- 大纲与折叠支持 Rust、Python、Go、TypeScript/JavaScript、C/C++、Java/C#、Markdown
- 原生 CSV 表格编辑器（可直接编辑单元格并写回文件）
- 图片、PDF、HTML、Markdown、Mermaid 预览编辑器

**其他**

- 集成终端——由 Rust 提供真实 PTY，支持 shell 探测、调整尺寸、发送信号
- 文件监听、文件名搜索与全文搜索，全部由 Rust 承担
- 多个内置主题
- 原生系统菜单
- 设置、键位与 SQLite 存储，全部本地持久化

---

## 尚未实现的能力

与其让你用起来才发现，不如直接列出来。

| 方面 | 现状 |
|---|---|
| 文件操作 | 没有右键菜单，没有重命名 / 新建 / 删除 / 复制 / 粘贴，没有拖放。Rust 层已有对应命令，界面尚未接上。 |
| 回收站 | 删除即永久删除。 |
| 会话恢复 | 重启后不会恢复目录标签、打开的文件、光标位置和滚动偏移。 |
| 大目录 | 文件列表一次性渲染全部行——上万条记录会卡顿。 |
| Shell 集成 | 没有 Windows 系统图标、没有缩略图、没有属性对话框、没有扩展右键菜单。 |
| 语言智能 | 没有补全、没有跳转定义、没有查找引用、没有重命名重构、没有诊断。SideX 按设计不运行语言服务器。 |
| Git | 未实现，也不计划实现。 |
| 扩展市场 | 已移除。仅有内置声明式扩展（语法、主题、语言配置）。 |
| 多窗口 | 单窗口，菜单自绘。 |
| 账号与同步 | 无。完全独立运行。 |

---

## 快速开始

### 本地开发

```bash
git clone https://github.com/Sidenai/sidex.git
cd sidex
npm install
npm run tauri dev
```

### 从源码构建

```bash
npm install
npx tauri build
```

`npx tauri build` 会自动执行前端构建（`npm run build`），其中已经把 Vite 的 Node 堆上限提到 12 GB——普通机器上无需设置 `NODE_OPTIONS`。如果仍然遇到内存不足，请在命令前自行提高上限：`NODE_OPTIONS="--max-old-space-size=16384"`。

首次构建需要 5–10 分钟（Rust 编译时间）。目前尚未分发预编译二进制。

以上命令均可独立运行，不需要账号，也无需任何额外配置。

---

## 实现方式

SideX 把 VS Code 的 Electron 架构逐层映射到 Tauri：

| VS Code（Electron） | SideX（Tauri） |
|---|---|
| Electron 主进程 | Tauri Rust 后端 |
| `BrowserWindow` | `WebviewWindow` |
| `ipcMain` / `ipcRenderer` | `invoke()` + Tauri 事件 |
| Node.js `fs`、`pty` 等 | Rust 命令（`std::fs`、`portable-pty`） |
| 菜单 / 对话框 / 剪贴板 | Tauri 插件 |
| 渲染进程（DOM + TypeScript） | 完全相同——运行在原生 WebView 中 |
| 扩展宿主 | 无运行时，仅内置声明式扩展 |

前端 TypeScript 是 VS Code workbench 的直接移植。Rust 后端位于 `src-tauri/src/commands/`，承担所有原本属于 Node.js 原生模块的工作：文件 I/O、终端 PTY、文件监听、搜索索引、SQLite、语法分析以及进程管理。

### 目录结构

```
sidex/
├── src/                    # TypeScript workbench（移植自 VS Code）
│   └── vs/
│       ├── base/           # 基础工具
│       ├── platform/       # 平台服务与依赖注入
│       ├── editor/         # Monaco 编辑器
│       └── workbench/      # IDE 外壳、面板、功能、贡献点
├── src-tauri/              # Rust 后端
│   └── src/
│       ├── commands/       # fs、terminal、search、syntax、extensions 等
│       ├── lib.rs          # 应用装配与命令注册
│       └── main.rs         # 入口
├── crates/                 # Rust 支持 crate —— text、syntax、theme、settings、workspace、terminal、extensions
├── index.html
├── vite.config.ts
└── package.json
```

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | TypeScript、Vite 6、Monaco Editor |
| 终端 UI | xterm.js + WebGL 渲染器 |
| 语法 / 主题 | vscode-textmate、vscode-oniguruma（WASM） |
| 后端 | Rust、Tauri 2 |
| 终端 | portable-pty（Rust） |
| 文件监听 | notify crate |
| 搜索 | dashmap + rayon + regex（Rust 并行） |
| 存储 | rusqlite（SQLite） |
| 扩展 | 内置声明式扩展（TextMate 语法、主题、语言配置） |

想深入了解，可阅读 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 参与贡献

项目以早期版本发布，目的是让外部贡献者参与进来。

### 如何参与

1. Fork 仓库并创建分支
2. 挑一件事做——看看 [Issues](https://github.com/Sidenai/sidex/issues)，或从上面的[尚未实现的能力](#尚未实现的能力)列表里选
3. 提交 PR——贡献者会被署名

### 开发须知

- 遵循 VS Code 的代码组织方式——读过 VS Code 源码就会很熟悉
- TypeScript 导入使用 `.js` 后缀（ES module 约定）
- 服务使用 VS Code 的 `@inject` 依赖注入装饰器
- 新增 Rust 命令放在 `src-tauri/src/commands/`，并在 `lib.rs` 中注册

---

## 社区

- **Discord：** [加入 SideX 服务器](https://discord.gg/8CUCnEAC4J)
- **X / Twitter：** [@ImRazshy](https://x.com/ImRazshy)
- **邮箱：** kendall@siden.ai

---

## 许可证

MIT —— SideX 是 [Visual Studio Code（Code - OSS）](https://github.com/microsoft/vscode) 的移植，后者同为 MIT 许可。详见 [LICENSE](./LICENSE)。
