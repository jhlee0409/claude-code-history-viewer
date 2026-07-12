<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**AI 编程助手的统一历史查看器。**

浏览、搜索和分析 **Claude Code**、**Gemini CLI**、**Antigravity**、**Codex CLI**、**Cline**、**Cursor**、**Aider**、**OpenCode**、**ForgeCode** 和 **CodeBuddy Code** 的对话记录 — 桌面应用或无头服务器。100% 离线。

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
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) / [`.zip` (便携版)](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

**Homebrew** (macOS)：

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

**无头服务器** — 从任意浏览器访问：

```bash
brew install jhlee0409/tap/cchv-server   # or: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

Docker、VPS、systemd 设置请参阅[服务器模式](#服务器模式-webui)。

---

## 为什么做这个

AI 编程助手生成了数千条对话消息，但它们都不提供跨工具回顾历史的方式。CCHV 解决了这个问题。

**二十五个助手。一个查看器。** 在 Claude Code、GitHub Copilot、Gemini CLI、Antigravity、Codex CLI、Cline（含 Roo Code 和 Kilo Code）、Cursor、Cursor Agent、Aider、OpenCode、ForgeCode、CodeBuddy Code、Kimi、Kiro、Amazon Q CLI、Continue.dev、PearAI、Goose、Crush、llm、Open Interpreter、Qwen Code、Zed、OpenHands 和 Trae 会话之间无缝切换 — 比较 Token 用量、跨提供商搜索、在一个界面中分析你的工作流。

| 提供商 | 数据位置 | 获取内容 |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | 完整对话历史、工具使用、思维过程、成本 |
| **GitHub Copilot** | `~/.copilot/session-state/`（CLI 和 Desktop）、VS Code `workspaceStorage/.../chatSessions/` | Copilot CLI、Copilot Desktop 和 VS Code Copilot Chat 历史（只读，支持 WSL） |
| **Gemini CLI** | `~/.gemini/history/` | 包含工具调用的对话历史 |
| **Antigravity** | `~/.gemini/antigravity/` | `brain/` 下的对话状态，以及 `.token-monitor/rpc-cache/v1/` 下的 Token 监控数据 |
| **Codex CLI** | `~/.codex/sessions/` | 包含代理响应的会话记录 |
| **Cline**（含 Roo Code、Kilo Code） | VS Code `globalStorage/<ext>/tasks/` | Cline 系列基于任务的对话历史 |
| **Cursor** | `~/.cursor/` | Composer 和聊天对话 |
| **Cursor Agent** | `~/.cursor/projects/.../agent-transcripts/` | Agent 会话记录，独立于 Cursor IDE 数据源 |
| **Aider** | 项目目录 | 聊天记录和编辑日志 |
| **OpenCode** | `~/.local/share/opencode/` | 对话会话和工具结果 |
| **ForgeCode** | `~/.forge/.forge.db` | SQLite 数据库中的对话记录 |
| **CodeBuddy Code** | `~/.codebuddy/projects/` | 包含工具调用的对话历史（Claude Code fork 格式） |
| **Kimi** | `~/.kimi/` | 会话历史，支持 `kimi -r` 恢复 |
| **Kiro** | `kiro-cli/data.sqlite3` | 基于 SQLite 的对话历史 |
| **Amazon Q CLI** | `…/amazon-q/data.sqlite3` | SQLite `conversations` 存储（与 Kiro CLI 提供商共用格式） |
| **Continue.dev** | `~/.continue/sessions/*.json` | 按工作区分组的单会话 JSON（支持 `CONTINUE_GLOBAL_DIR`） |
| **PearAI** | `~/.pearai/sessions/` | Continue fork — 相同的会话格式 |
| **Goose** | `…/goose/sessions/sessions.db` | Block 的智能体 — SQLite 会话 + 消息 |
| **Crush** | 每项目 `./.crush/crush.db` | Charm 的 TUI — SQLite，在常见代码根目录下自动发现 |
| **llm** | `…/io.datasette.llm/logs.db` | Simon Willison 的 CLI — 含 Token 计数的 SQLite conversations/responses |
| **Open Interpreter** | `~/.openinterpreter/sessions/` | Codex 格式 rollouts（复用 Codex 解析器；支持 `INTERPRETER_HOME` 覆盖） |
| **Qwen Code** | `~/.qwen/projects/.../chats/` | 每会话 JSONL 记录（工具调用、思维过程、Token 用量） |
| **Zed** | `…/Zed/threads/threads.db` | Agent Panel 线程 — SQLite + Zstd 压缩 JSON |
| **OpenHands** | `~/.openhands/sessions/` | 经典事件存储对话 |
| **Trae** | `…/Trae/User/workspaceStorage/.../state.vscdb` | 按工作区的聊天记录（icube 存储；实验性，逆向工程） |

无供应商锁定。无云依赖。本地对话文件，精美呈现。

Antigravity 说明：查看器将 Antigravity 根目录解析为 `~/.gemini/antigravity`，然后从 `brain/` 读取会话状态，并从 `.token-monitor/rpc-cache/v1/` 读取用量/缓存数据；这与当前运行时布局以及 `src-tauri/src/commands/antigravity.rs` 中的根目录解析器一致。

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
| **多提供商支持** | 统一查看 **25 个 AI 编程助手** — Claude Code、GitHub Copilot、Gemini CLI、Codex CLI、Cursor / Cursor Agent、Cline（含 Roo Code 和 Kilo Code）、Aider、OpenCode、ForgeCode、CodeBuddy Code、Kimi、Kiro、Antigravity、Amazon Q CLI、Continue.dev、PearAI、Goose、Crush、llm、Open Interpreter、Qwen Code、Zed、OpenHands 和 Trae — 按提供商筛选、跨工具比较 |
| **对话浏览器** | 按项目/会话导航对话,支持工作树分组 |
| **全局搜索** | 即时搜索所有提供商的对话内容 |
| **分析仪表板** | 双模式 Token 统计（计费 vs 对话）、成本明细、提供商分布图表 |
| **会话面板** | 多会话可视化分析,支持像素视图、属性筛选和活动时间线 |
| **设置管理器** | 作用域感知的 Claude Code 设置编辑器,支持 MCP 服务器管理 |
| **消息导航器** | 右侧可折叠目录,快速浏览对话内容 |
| **实时监控** | 实时监听会话文件变化并即时更新 |

### Provider 说明

| 提供商 | 说明 |
|---------|-------|
| **Antigravity** | 走现有统一 provider 数据流接入。会话来自 token monitor 缓存，可直接参与项目/会话浏览、Token 统计、分析仪表板和全局搜索，无需单独的专用页面。 |

### v1.18.0 新增

| 功能 | 描述 |
|------|------|
| **更快的启动** | 提供商扫描器由顺序执行改为并发执行，与查看器同时运行的其他工具锁住的 SQLite 数据库不再拖慢整个扫描 — 消除数秒的"正在初始化应用…"卡顿 |
| **搜索结果上下文** | 全局搜索结果现在显示每个匹配所属的对话，跨会话出现相同文本的匹配一目了然 |
| **可折叠提供商筛选** | 侧边栏的提供商筛选面板可折叠，为会话列表腾出纵向空间；折叠后的标题仍显示当前筛选摘要和数量 |
| **可验证的项目名称** | 项目标识优先使用磁盘上的文件夹名，而非旧记录中过期的 `cwd`，被移动或由 subagent 记录的项目现在能正确分组（一次性透明重扫描） |
| **修复** | 导出 subagent 会话现在包含其消息，不再生成空文件；OpenCode 全局会话按目录拆分（空目录会话也能正确加载）；OpenCode 会话缓存加上上限，防止内存无限增长 |

### v1.17.0 新增

| 功能 | 描述 |
|------|------|
| **十一个新提供商** | 浏览 **Continue.dev** 和 **PearAI**（`~/.continue` / `~/.pearai` 会话 JSON）、**Goose**（SQLite）、**Crush**（每项目 SQLite）、**llm**（Simon Willison 的 CLI）、**Amazon Q CLI**、**Open Interpreter**（Codex 格式 rollouts）、**Qwen Code**、**Zed**（Agent Panel 线程 — SQLite + Zstd）、**OpenHands** 和 **Trae** 的历史 — 另有通过 Cline 系列读取器支持的 **Kilo Code**。覆盖范围从 14 个助手扩展到 25 个。 |
| **Kiro Windows 路径修复** | Kiro CLI 数据库在 Windows 上现通过 `data_local_dir()`（`%LOCALAPPDATA%`）解析，取代错误的 `AppData\Roaming` |

### v1.16.0 新增

| 功能 | 描述 |
|------|------|
| **GitHub Copilot 提供商** | 只读浏览 **Copilot CLI**（`~/.copilot/session-state`）、**Copilot Desktop** 和 **VS Code Copilot Chat**（`workspaceStorage/.../chatSessions`）历史 — 支持 WSL，支持全局搜索 |
| **无头会话导出** | 新增 `--export <session-id\|/abs/path.jsonl> [--format html\|json] [--output <file>]` 标志，生成 HTML 或 JSON 报告后直接退出，不启动 GUI — 适用于 SSH/CI 场景 |
| **一键完整备份** | 归档管理器新增"完整备份"卡片，一次操作即可将所有 Claude Code 项目的全部会话复制到归档，历史记录不再受 Claude Code 自动清理影响 |
| **Skill 与 Subagent 分析** | 新增"最常用 Skills" / "最常用 Subagents"版块，按名称统计 Claude `Skill` 和 `Agent` 调用，支持项目和全局两种范围 |
| **修复** | 字体大小设置现在应用于整个应用（消息查看器、分析、会话面板、设置），不再仅限左侧面板；系统回收站不可用时（如 Windows 回收站被禁用），会话删除回退为永久删除 |

### v1.15.0 新增

| 功能 | 描述 |
|------|------|
| **三个新提供商** | 浏览 **Cursor Agent**（agent-transcripts，独立于 Cursor IDE 数据源）、**Kimi**（`~/.kimi`，支持 `kimi -r` 恢复）和 **Kiro**（基于 SQLite 的 `kiro-cli`）的历史 |
| **Codex 原生重命名与删除** | 重命名 Codex 会话 — 标题写入 `state_5.sqlite` 并显示在 `codex` resume 选择器中，rollout 记录保持不可变 — 并可通过应用内新增的确认对话框删除会话；支持 `CODEX_HOME`（sessions + archived） |
| **更快的扫描与搜索** | Codex 项目列表只扫描 session-meta 行（mmap + memchr），各提供商独立扫描，慢的提供商不再阻塞快的；会话内搜索索引移至 Web Worker，大会话不再冻结 UI |
| **准确的 Claude 项目路径** | 项目名和 `claude --resume` 工作目录现从会话元数据解析，取代有损的文件夹编码（首次启动时一次性透明重扫描） |
| **修复** | 消除虚拟化消息历史中的空白间隙；修复 macOS 上 Kimi 自动刷新；修复多字节工作区文件夹名导致的 Cursor 扫描崩溃 |

### v1.14.0

| 功能 | 描述 |
|------|------|
| **CodeBuddy Code 提供商** | 新增 CodeBuddy Code — 与其他 AI 编程助手一起浏览其对话历史 |
| **WebUI 账户登录** | `--serve` 模式新增可选账户认证（Argon2id + 服务端会话 + CSRF）、只读模式和反向代理托管的 base-path 支持 |
| **持久化消息筛选** | 角色和内容类型筛选现在跨会话切换和应用重启后保持 |
| **Subagent 会话稳定性** | 修复多 subagent 点击映射错误，以及打开大型 subagent 会话时的偶发崩溃 |
| **Linux IME 输入** | 修复 Linux 搜索框中的 ibus/fcitx 输入（韩语、中文、日语） |

### v1.13.0

| 功能 | 描述 |
|------|------|
| **macOS 自定义标题栏** | 可拖动的覆盖层标题栏替换传统 macOS 标题栏 — 屏幕空间利用更一致；Linux/Windows 不受影响 |
| **会话来源筛选** | 基于 Claude Code 的 `entrypoint` 字段按创建位置（CLI / VS Code / Desktop）筛选会话 |
| **Codex Resume 支持** | 右键"复制 Resume 命令"现支持 Codex 会话，并自动添加 `cd '<cwd>' && ` 前缀 — 粘贴运行即可在原目录恢复 |
| **定价准确性** | 修复 `claude-opus-4-7` 3 倍超额计费；新增 `gpt-5.4`/`gpt-5.5` 定价并分离处理 Codex 缓存 token |
| **macOS 更新器稳定化** | 针对 Tauri v2 macOS relaunch bug 的 OS 级原生重启回退 — 不再显示"请手动重启" |

> 历史版本：v1.12.0 及更早请参见 [CHANGELOG.md](./CHANGELOG.md)

### 更多

| 功能 | 描述 |
|---------|-------------|
| **会话上下文菜单** | 复制会话 ID、恢复命令和文件路径；删除会话、显示 JSONL 文件；原生重命名集成搜索 |
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

# Option 1: Using just (recommended)
brew install just    # or: cargo install just
just setup
just dev             # Development
just tauri-build     # Production build

# Option 2: Using pnpm directly
pnpm install
pnpm tauri:dev       # Development
pnpm tauri:build     # Production build
```

**系统要求**: Node.js 18+, pnpm, Rust 工具链

## 服务器模式 (WebUI)

无需桌面环境，作为无头 HTTP 服务器运行 — 适合 VPS、远程服务器或 Docker。服务器二进制文件内嵌前端 — **只需一个文件**。

> **初次部署服务器？** 请参阅完整的[服务器模式指南](docs/server-guide.md)（[한국어](docs/server-guide.ko.md)），涵盖本地测试、VPS 设置、Docker 等详细步骤。

### 快速安装

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# Or one-line script
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

两种方式都会将 `cchv-server` 安装到 PATH。

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
- **环境变量**: `CCHV_TOKEN=your-token cchv-server --serve`（适用于 systemd/Docker）。
- **禁用**: `--no-auth` 完全跳过认证（仅在可信网络使用）。

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
sudo systemctl edit --full cchv.service   # Set User= to your username
sudo systemctl enable --now cchv.service
```

### 从源码构建（仅服务器）

```bash
just serve-build           # Build frontend + embed into server binary
just serve-build-run       # Build and run (embedded assets)

# Or run in development (external dist/):
just serve-dev             # Build frontend + run server with --dist
```

### 健康检查

```
GET /health
→ { "status": "ok" }
```

## 使用方法

1. 启动应用
2. 自动扫描全部 25 个支持的提供商（Claude Code、Codex CLI、Gemini CLI、Cursor、Cline、Continue.dev、Goose、Zed、Qwen Code、Amazon Q CLI 等 — 参见上方提供商表格）的对话数据
3. 在左侧边栏浏览项目 — 使用标签栏按提供商筛选
4. 点击会话查看消息
5. 使用标签页在消息、分析、Token 统计、最近编辑和会话面板之间切换

### 命令行参数

使用 `--session` 参数启动应用并预先聚焦到指定会话：

```bash
# Full UUID
claude-code-history-viewer --session 1265cd74-caa9-472e-b343-c4f44b5cf12c

# UUID prefix (8+ hex-or-dash chars, up to 36) — first match wins
claude-code-history-viewer --session 1265cd74

# Equals form also works
claude-code-history-viewer --session=1265cd74
```

应用会扫描所有已知项目并导航到匹配的会话；若没有匹配会话，则按正常流程启动。既不是 hex-或-短横线的 8-36 字符也不是绝对路径的值将被静默忽略。

## 无障碍

为键盘操作、低视力和屏幕阅读器用户提供无障碍功能。

- 键盘优先导航：
  - 项目浏览器、主内容区、消息导航器和设置的跳转链接
  - `ArrowUp/ArrowDown/Home/End` 导航项目树，支持输入即搜，`*` 展开兄弟组
  - `ArrowUp/ArrowDown/Home/End` 导航消息导航器，`Enter` 打开聚焦的消息
- 视觉无障碍：
  - 持久化的全局字体大小缩放（`90%`、`100%`、`110%`、`120%`、`130%`）
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
