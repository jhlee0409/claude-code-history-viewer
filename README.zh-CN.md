<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AI 编程助手的统一历史查看器。**

浏览、搜索和分析 **Claude Code**、**Codex CLI** 和 **OpenCode** 的对话记录 — 桌面应用或无头服务器。100% 离线。

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Stars](https://img.shields.io/github/stars/jhlee0409/claude-code-history-viewer?style=flat&color=yellow)](https://github.com/jhlee0409/claude-code-history-viewer/stargazers)
[![License](https://img.shields.io/github/license/jhlee0409/claude-code-history-viewer)](LICENSE)
[![Rust Tests](https://img.shields.io/github/actions/workflow/status/jhlee0409/claude-code-history-viewer/rust-tests.yml?label=Rust%20Tests)](https://github.com/jhlee0409/claude-code-history-viewer/actions/workflows/rust-tests.yml)
[![Last Commit](https://img.shields.io/github/last-commit/jhlee0409/claude-code-history-viewer)](https://github.com/jhlee0409/claude-code-history-viewer/commits/main)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[官网](https://jhlee0409.github.io/claude-code-history-viewer/) · [下载](https://github.com/jhlee0409/claude-code-history-viewer/releases) · [报告问题](https://github.com/jhlee0409/claude-code-history-viewer/issues)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

</div>

---

<p align="center">
  <img width="49%" alt="Conversation History" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="Token Statistics" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="Recent Edits" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

## 快速开始

**桌面应用** — 下载并运行：

| 平台 | 下载 |
|----------|----------|
| macOS (通用) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

**Homebrew** (macOS)：

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

**无头服务器** — 从浏览器访问：

```bash
brew install jhlee0409/tap/cchv-server   # 或: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker、VPS、systemd 设置请参阅[服务器模式](#服务器模式-webui)。

---

## 为什么做这个

AI 编程助手生成了数千条对话消息，但它们都不提供跨工具回顾历史的方式。CCHV 解决了这个问题。

**三个助手。一个查看器。** 在 Claude Code、Codex CLI 和 OpenCode 会话之间无缝切换 — 比较 Token 用量、跨提供商搜索、在一个界面中分析你的工作流。

| 提供商 | 数据位置 | 获取内容 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 完整对话历史、工具使用、思维过程、成本 |
| **Codex CLI** | `~/.codex/sessions/` | 包含代理响应的会话记录 |
| **OpenCode** | `~/.local/share/opencode/` | 对话会话和工具结果 |

无供应商锁定。无云依赖。本地对话文件，精美呈现。

## 目录

- [功能特性](#功能特性)
- [安装](#安装)
- [从源码构建](#从源码构建)
- [服务器模式 (WebUI)](#服务器模式-webui)
- [使用方法](#使用方法)
- [无障碍](#无障碍)
- [技术栈](#技术栈)
- [数据隐私](#数据隐私)
- [常见问题](#常见问题)
- [贡献](#贡献)
- [许可证](#许可证)

## 功能特性

### 核心

| 功能 | 描述 |
|---------|-------------|
| **多提供商支持** | 统一查看 **Claude Code**、**Codex CLI** 和 **OpenCode** 对话 — 按提供商筛选、跨工具比较 |
| **对话浏览器** | 按项目/会话导航对话,支持工作树分组 |
| **全局搜索** | 即时搜索所有提供商的对话内容 |
| **分析仪表板** | 双模式 Token 统计（计费 vs 对话）、成本明细、提供商分布图表 |
| **会话面板** | 多会话可视化分析,支持像素视图、属性筛选和活动时间线 |
| **设置管理器** | 作用域感知的 Claude Code 设置编辑器,支持 MCP 服务器管理 |
| **消息导航器** | 右侧可折叠目录,快速浏览对话内容 |
| **实时监控** | 实时监听会话文件变化并即时更新 |

### v1.6.0 新增

| 功能 | 描述 |
|---------|-------------|
| **WebUI 服务器模式** | 使用 `--serve` 作为无头 Web 服务器运行 — 从浏览器访问，部署到 VPS/Docker |
| **截图捕获** | 支持范围选择、预览模态框和多选导出的长截图 |
| **归档管理** | 创建、浏览、重命名和导出会话归档，支持逐文件下载 |
| **无障碍** | 完整键盘导航、屏幕阅读器支持、字体缩放和高对比度模式 |
| **移动端 UI** | 390px 视口支持，底部标签栏 |
| **外部链接** | 所有链接在系统浏览器中打开，而非 WebView |

### 更多

| 功能 | 描述 |
|---------|-------------|
| **会话上下文菜单** | 复制会话 ID、恢复命令和文件路径;原生重命名集成搜索 |
| **ANSI 颜色渲染** | 以原始 ANSI 颜色显示终端输出 |
| **多语言** | 英语、韩语、日语、简体中文、繁体中文 |
| **最近编辑** | 查看文件修改历史并恢复 |
| **自动更新** | 内置更新器,支持跳过/延迟选项 |

## 安装

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

或者使用完整 Cask 路径直接安装:

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

如果出现 `No Cask with this name exists`，请使用上面的完整路径命令。

升级:

```bash
brew upgrade --cask claude-code-history-viewer
```

卸载:

```bash
brew uninstall --cask claude-code-history-viewer
```

> **从手动安装(.dmg)迁移？**
> 为避免冲突，请先删除现有应用，然后通过 Homebrew 安装。
> 请只使用**一种**安装方式 — 不要混合使用手动安装和 Homebrew。
> ```bash
> # 先删除手动安装的应用
> rm -rf "/Applications/Claude Code History Viewer.app"
> # 通过 Homebrew 安装
> brew tap jhlee0409/tap
> brew install --cask claude-code-history-viewer
> ```

## 从源码构建

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# 方式 1: 使用 just (推荐)
brew install just    # 或: cargo install just
just setup
just dev             # 开发模式
just tauri-build     # 生产构建

# 方式 2: 直接使用 pnpm
pnpm install
pnpm tauri:dev       # 开发模式
pnpm tauri:build     # 生产构建
```

**系统要求**: Node.js 18+, pnpm, Rust 工具链

## 服务器模式 (WebUI)

无需桌面环境，作为无头 HTTP 服务器运行 — 适合 VPS、远程服务器或 Docker。服务器二进制文件内嵌前端 — **只需一个文件**。

> **初次部署服务器？** 请参阅完整的[服务器模式指南](docs/server-guide.md)，涵盖本地测试、VPS 设置、Docker 等详细步骤。

### 快速安装

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# 或一行脚本
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

### 启动服务器

```bash
cchv-server --serve
```

输出:

```
🔑 Auth token: b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
   Open in browser: http://192.168.1.10:3727?token=b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
👁 File watcher active: /home/user/.claude/projects
🚀 WebUI server running at http://0.0.0.0:3727
```

在浏览器中打开 URL — 令牌会自动保存。

### 预构建二进制文件

| 平台 | 资产 |
|----------|-------|
| Linux x64 | `cchv-server-linux-x64.tar.gz` |
| Linux ARM64 | `cchv-server-linux-arm64.tar.gz` |
| macOS ARM | `cchv-server-macos-arm64.tar.gz` |
| macOS x64 | `cchv-server-macos-x64.tar.gz` |

从 [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases) 下载。

**CLI 选项:**

| 标志 | 默认值 | 描述 |
|------|---------|-------------|
| `--serve` | — | **必需。** 启动 HTTP 服务器而非桌面应用 |
| `--port <number>` | `3727` | 服务器端口 |
| `--host <address>` | `0.0.0.0` | 绑定地址（仅本地: `127.0.0.1`） |
| `--token <value>` | 自动 (uuid v4) | 自定义认证令牌 |
| `--no-auth` | — | 禁用认证（不建议在公共网络使用） |
| `--dist <path>` | 内嵌 | 使用外部 `dist/` 目录替代内嵌前端 |

### 认证

所有 `/api/*` 端点受 Bearer 令牌认证保护。令牌在每次服务器启动时自动生成并输出到 stderr。

- **浏览器访问**: 使用启动时输出的 `?token=...` URL。令牌自动保存到 `localStorage`。
- **API 访问**: 包含 `Authorization: Bearer <token>` 请求头。
- **自定义令牌**: `--token my-secret-token` 设置自定义令牌。
- **禁用**: `--no-auth` 跳过认证（仅在可信网络使用）。

### 实时更新

服务器监控 `~/.claude/projects/` 的文件变化，并通过 SSE（Server-Sent Events）将更新推送到浏览器。在另一个终端使用 Claude Code 时，查看器自动更新 — 无需手动刷新。

### Docker

```bash
docker compose up -d
```

启动后检查令牌:

```bash
docker compose logs webui
# 🔑 Auth token: ... ← 将此 URL 粘贴到浏览器
```

`docker-compose.yml` 将 `~/.claude`、`~/.codex` 和 `~/.local/share/opencode` 作为只读卷挂载。

### systemd 服务

在 Linux 上持久运行服务器，使用提供的 systemd 模板:

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # 将 User= 设为您的用户名
sudo systemctl enable --now cchv.service
```

### 从源码构建（仅服务器）

```bash
just serve-build           # 构建前端 + 嵌入服务器二进制文件
just serve-build-run       # 构建并运行（嵌入资产）

# 或以开发模式运行（外部 dist/）:
just serve-dev             # 构建前端 + 使用 --dist 运行服务器
```

### 健康检查

```
GET /health
→ { "status": "ok" }
```

## 使用方法

1. 启动应用
2. 自动扫描所有支持的提供商 (Claude Code、Codex CLI、OpenCode) 的对话数据
3. 在左侧边栏浏览项目 — 使用标签栏按提供商筛选
4. 点击会话查看消息
5. 使用标签页在消息、分析、Token 统计、最近编辑和会话面板之间切换

## 无障碍

为键盘操作、低视力和屏幕阅读器用户提供无障碍功能。

- 键盘优先导航：
  - 项目浏览器、主内容区、消息导航器和设置的跳转链接
  - `ArrowUp/ArrowDown/Home/End` 导航项目树，预搜索，`*` 展开兄弟组
  - `ArrowUp/ArrowDown/Home/End` 和 `Enter` 导航消息导航器并打开聚焦的消息
- 视觉无障碍：
  - 全局字体大小缩放（`90%`、`100%`、`110%`、`120%`、`130%`）
  - 设置中高对比度模式切换
- 屏幕阅读器支持：
  - 地标和树/列表语义（`navigation`、`tree`、`treeitem`、`group`、`listbox`、`option`）
  - 状态/加载和项目树导航/选择变更的实时播报
  - 通过 `aria-describedby` 提供内联键盘帮助说明

## 技术栈

| 层级 | 技术 |
|-------|------------|
| **后端** | ![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?logo=tauri&logoColor=white) |
| **前端** | ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) |
| **状态管理** | ![Zustand](https://img.shields.io/badge/Zustand-433E38?logo=react&logoColor=white) |
| **构建工具** | ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) |
| **国际化** | ![i18next](https://img.shields.io/badge/i18next-26A69A?logo=i18next&logoColor=white) 5 种语言 |

## 数据隐私

**100% 离线运行。** 不会将任何对话数据发送到任何服务器。无分析、无跟踪、无遥测。

您的数据保留在您的设备上。

## 常见问题

| 问题 | 解决方案 |
|---------|----------|
| "未找到 Claude 数据" | 确保 `~/.claude` 目录存在且包含对话历史 |
| 性能问题 | 大量历史记录初次加载可能较慢 — 应用使用虚拟滚动优化性能 |
| 更新问题 | 如果自动更新失败,请从 [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases) 手动下载 |

## 贡献

欢迎贡献! 以下是入门指南:

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/my-feature`)
3. 提交前运行检查:
   ```bash
   pnpm tsc --build .        # TypeScript
   pnpm vitest run            # 测试
   pnpm lint                  # 代码检查
   ```
4. 提交更改 (`git commit -m 'feat: add my feature'`)
5. 推送到分支 (`git push origin feat/my-feature`)
6. 创建 Pull Request

查看 [开发命令](CLAUDE.md#development-commands) 了解完整的可用命令列表。

## 许可证

[MIT](LICENSE) — 免费用于个人和商业用途。

---

<div align="center">

如果这个项目对您有帮助,请给它一个星标!

[![Star History Chart](https://api.star-history.com/svg?repos=jhlee0409/claude-code-history-viewer&type=Date)](https://star-history.com/#jhlee0409/claude-code-history-viewer&Date)

</div>
