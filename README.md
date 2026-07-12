<div align="center">

<img src="docs/assets/app-icon.png" alt="CCHV Logo" width="120" />

# Claude Code History Viewer

**The unified history viewer for AI coding assistants.**

Browse, search, and analyze conversations from **Claude Code**, **Gemini CLI**, **Antigravity**, **Codex CLI**, **Cline**, **Cursor**, **Aider**, **OpenCode**, **ForgeCode**, and **CodeBuddy Code** — as a desktop app or headless server. 100% offline.

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Stars](https://img.shields.io/github/stars/jhlee0409/claude-code-history-viewer?style=flat&color=yellow)](https://github.com/jhlee0409/claude-code-history-viewer/stargazers)
[![License](https://img.shields.io/github/license/jhlee0409/claude-code-history-viewer)](LICENSE)
[![Rust Tests](https://img.shields.io/github/actions/workflow/status/jhlee0409/claude-code-history-viewer/rust-tests.yml?label=Rust%20Tests)](https://github.com/jhlee0409/claude-code-history-viewer/actions/workflows/rust-tests.yml)
[![Last Commit](https://img.shields.io/github/last-commit/jhlee0409/claude-code-history-viewer)](https://github.com/jhlee0409/claude-code-history-viewer/commits/main)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[Website](https://jhlee0409.github.io/claude-code-history-viewer/) · [Download](https://github.com/jhlee0409/claude-code-history-viewer/releases) · [Report Bug](https://github.com/jhlee0409/claude-code-history-viewer/issues)

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

## Quick Start

**Desktop app** — download and run:

| Platform | Download |
|----------|----------|
| macOS (Universal) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) / [`.zip` (portable)](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

**Homebrew** (macOS):

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

**Headless server** — access from any browser:

```bash
brew install jhlee0409/tap/cchv-server   # or: curl -fsSL https://...install-server.sh | sh
cchv-server --serve                       # → http://localhost:3727
```

See [Server Mode](#server-mode-webui) for Docker, VPS, and systemd setup.

---

## Why This Exists

AI coding assistants generate thousands of conversation messages, but none of them provide a way to look back at your history across tools. CCHV solves this.

**Twenty-eight assistants. One viewer.** Switch between Claude Code, GitHub Copilot, Gemini CLI, Antigravity, Codex CLI, Cline (incl. Roo Code & Kilo Code), Cursor, Cursor Agent, Aider, OpenCode, ForgeCode, CodeBuddy Code, Kimi, Kiro, Amazon Q CLI, Continue.dev, PearAI, Goose, Crush, llm, Open Interpreter, Pi, oh-my-pi, Mistral Vibe, Qwen Code, Zed, OpenHands, and Trae sessions seamlessly — compare token usage, search across providers, and analyze your workflow in a single interface.

| Provider | Data Location | What You Get |
|----------|--------------|--------------|
| **Claude Code** | `~/.claude/projects/` | Full conversation history, tool use, thinking, costs |
| **GitHub Copilot** | `~/.copilot/session-state/` (CLI & Desktop), VS Code `workspaceStorage/.../chatSessions/` | Copilot CLI, Copilot Desktop, and VS Code Copilot Chat history (read-only, WSL-aware) |
| **Gemini CLI** | `~/.gemini/history/` | Conversation history with tool calls |
| **Antigravity** | `~/.gemini/antigravity/` | Conversation state under `brain/` plus token monitor data under `.token-monitor/rpc-cache/v1/` |
| **Codex CLI** | `~/.codex/sessions/` | Session rollouts with agent responses |
| **Cline** (incl. Roo Code, Kilo Code) | VS Code `globalStorage/<ext>/tasks/` | Task-based history across the Cline family |
| **Cursor** | `~/.cursor/` | Composer and chat conversations |
| **Cursor Agent** | `~/.cursor/projects/.../agent-transcripts/` | Agent transcripts, distinct from the Cursor IDE source |
| **Aider** | Project directories | Chat history and edit logs |
| **OpenCode** | `~/.local/share/opencode/` | Conversation sessions and tool results |
| **ForgeCode** | `~/.forge/.forge.db` | Conversation history from SQLite database |
| **CodeBuddy Code** | `~/.codebuddy/projects/` | Conversation history with tool calls (Claude Code fork format) |
| **Kimi** | `~/.kimi/` | Session history with `kimi -r` resume |
| **Kiro** | `kiro-cli/data.sqlite3` | SQLite-backed conversation history |
| **Amazon Q CLI** | `…/amazon-q/data.sqlite3` | SQLite `conversations` store (shares format with the Kiro CLI provider) |
| **Continue.dev** | `~/.continue/sessions/*.json` | Per-session JSON, grouped by workspace (honors `CONTINUE_GLOBAL_DIR`) |
| **PearAI** | `~/.pearai/sessions/` | Continue fork — same session format |
| **Goose** | `…/goose/sessions/sessions.db` | Block's agent — SQLite sessions + messages |
| **Crush** | per-project `./.crush/crush.db` | Charm's TUI — SQLite, discovered across common code roots |
| **llm** | `…/io.datasette.llm/logs.db` | Simon Willison's CLI — SQLite conversations/responses with token counts |
| **Open Interpreter** | `~/.openinterpreter/sessions/` | Codex-format rollouts (reuses the Codex parser; `INTERPRETER_HOME` override) |
| **Pi** | `~/.pi/agent/sessions/` | Per-cwd JSONL transcripts — messages, thinking, tool calls, token usage |
| **oh-my-pi** | `~/.omp/agent/sessions/` | Pi-format sessions from the `omp` fork (shared parser) |
| **Mistral Vibe** | `~/.vibe/logs/session/` | OpenAI-style chat transcripts with reasoning and tool calls (`VIBE_HOME` override) |
| **Qwen Code** | `~/.qwen/projects/.../chats/` | Per-session JSONL transcripts (tool calls, thinking, token usage) |
| **Zed** | `…/Zed/threads/threads.db` | Agent Panel threads — SQLite + Zstd-compressed JSON |
| **OpenHands** | `~/.openhands/sessions/` | Classic event-store conversations |
| **Trae** | `…/Trae/User/workspaceStorage/.../state.vscdb` | Per-workspace chat (icube store; experimental, reverse-engineered) |

No vendor lock-in. No cloud dependency. Your local conversation files, beautifully rendered.

Antigravity note: the viewer resolves the Antigravity root as `~/.gemini/antigravity` and then reads session state from `brain/` plus usage/cache artifacts from `.token-monitor/rpc-cache/v1/`; this matches the current runtime layout and root resolver in `src-tauri/src/commands/antigravity.rs`.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Build from Source](#build-from-source)
- [Server Mode (WebUI)](#server-mode-webui)
- [Usage](#usage)
- [Accessibility](#accessibility)
- [Tech Stack](#tech-stack)
- [Data Privacy](#data-privacy)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

### Core

| Feature | Description |
|---------|-------------|
| **Multi-Provider Support** | Unified viewer for **28 AI coding assistants** — Claude Code, GitHub Copilot, Gemini CLI, Codex CLI, Cursor / Cursor Agent, Cline (incl. Roo Code & Kilo Code), Aider, OpenCode, ForgeCode, CodeBuddy Code, Kimi, Kiro, Antigravity, Amazon Q CLI, Continue.dev, PearAI, Goose, Crush, llm, Open Interpreter, Pi, oh-my-pi, Mistral Vibe, Qwen Code, Zed, OpenHands, and Trae — filter by provider, compare across tools |
| **Conversation Browser** | Navigate conversations by project/session with worktree grouping |
| **Global Search** | Search across all conversations from all providers instantly |
| **Analytics Dashboard** | Dual-mode token stats (billing vs conversation), cost breakdown, and provider distribution charts |
| **Session Board** | Multi-session visual analysis with pixel view, attribute brushing, and activity timeline |
| **Settings Manager** | Scope-aware Claude Code settings editor with MCP server management |
| **Message Navigator** | Right-side collapsible TOC for quick conversation navigation |
| **Real-time Monitoring** | Live session file watching for instant updates |

### Provider Notes

| Provider | Notes |
|---------|-------|
| **Antigravity** | Loaded through the standard provider pipeline. Sessions come from the token monitor cache and participate in project/session views, token stats, analytics, and global search without a separate UI mode. |

### New in v1.18.0

| Feature | Description |
|---------|-------------|
| **Faster startup** | Provider scanners now run concurrently instead of sequentially, so a locked SQLite database from a tool running alongside the viewer no longer stalls the whole scan — eliminating multi-second "Initializing app…" hangs |
| **Search result context** | Global search results now show which conversation each match belongs to, so matches that share the same text across sessions are easy to tell apart |
| **Collapsible provider filter** | The sidebar provider-filter panel can collapse to reclaim vertical space for the session list; the collapsed header still surfaces the active filter summary and count |
| **Verifiable project names** | Project identity prefers the on-disk folder name over a stale `cwd` recorded in old transcripts, so moved or subagent-recorded projects group correctly (one-time transparent re-scan) |
| **Fixes** | Exporting a subagent session now includes its messages instead of producing an empty file; OpenCode global sessions split by directory (and empty-directory sessions load correctly); the OpenCode session cache is bounded to prevent unbounded memory growth |

### New in v1.17.0

| Feature | Description |
|---------|-------------|
| **Eleven new providers** | Browse history from **Continue.dev** & **PearAI** (`~/.continue` / `~/.pearai` session JSON), **Goose** (SQLite), **Crush** (per-project SQLite), **llm** (Simon Willison's CLI), **Amazon Q CLI**, **Open Interpreter** (Codex-format rollouts), **Qwen Code**, **Zed** (Agent Panel threads — SQLite + Zstd), **OpenHands**, and **Trae** — plus **Kilo Code** via the Cline-family reader. Coverage grows from 14 to 25 assistants. |
| **Kiro Windows path fix** | Kiro CLI database now resolves via `data_local_dir()` (`%LOCALAPPDATA%`) on Windows instead of the incorrect `AppData\Roaming` |

### New in v1.16.0

| Feature | Description |
|---------|-------------|
| **GitHub Copilot Provider** | Read-only history from **Copilot CLI** (`~/.copilot/session-state`), **Copilot Desktop**, and **VS Code Copilot Chat** (`workspaceStorage/.../chatSessions`) — WSL-aware, with global search |
| **Headless Session Export** | New `--export <session-id\|/abs/path.jsonl> [--format html\|json] [--output <file>]` flag renders an HTML or JSON report and exits without launching the GUI — for SSH/CI use |
| **One-Click Full Backup** | An Archive Manager "Full Backup" card copies every session from all Claude Code projects into archives in one action, so history survives Claude Code's automatic cleanup |
| **Skill & Subagent Analytics** | New "Most Used Skills" / "Most Used Subagents" sections break Claude `Skill` and `Agent` calls out by name, at project and global scope |
| **Fixes** | The font-size setting now applies to the whole app (message viewer, analytics, session board, settings), not just the left panel; session delete falls back to permanent deletion when the system trash is unavailable (e.g. Windows Recycle Bin disabled) |

### New in v1.15.0

| Feature | Description |
|---------|-------------|
| **Three New Providers** | Browse history from **Cursor Agent** (agent-transcripts, distinct from the Cursor IDE source), **Kimi** (`~/.kimi`, with `kimi -r` resume), and **Kiro** (SQLite-backed `kiro-cli`) |
| **Codex Native Rename & Delete** | Rename Codex sessions — the title is written to `state_5.sqlite` and shows in the `codex` resume picker, while the rollout transcript stays immutable — and delete sessions through a new in-app confirmation dialog; honors `CODEX_HOME` (sessions + archived) |
| **Faster Scans & Search** | Codex project lists scan only the session-meta line (mmap + memchr) and each provider scans independently, so a slow provider no longer blocks fast ones; in-session search indexing moved to a Web Worker so large sessions no longer freeze the UI |
| **Accurate Claude Project Paths** | Project name and the `claude --resume` working directory are now resolved from session metadata instead of the lossy folder encoding (one-time transparent re-scan on first launch) |
| **Fixes** | Removed blank gaps in the virtualized message history; fixed Kimi auto-refresh on macOS; fixed a Cursor scan crash on multibyte workspace-folder names |

### v1.14.0

| Feature | Description |
|---------|-------------|
| **CodeBuddy Code Provider** | Added CodeBuddy Code — browse its conversation history alongside your other AI coding assistants |
| **WebUI Account Login** | `--serve` mode gains optional account authentication (Argon2id + server-side sessions + CSRF), a read-only mode, and base-path support for reverse-proxy hosting |
| **Persistent Message Filters** | Role and content-type filters now persist across session switches and app restarts |
| **Subagent Session Stability** | Fixed multi-subagent click mapping and an occasional crash when opening large subagent sessions |
| **Linux IME Input** | Fixed ibus/fcitx input (Korean, Chinese, Japanese) in the search box on Linux |

### v1.13.0

| Feature | Description |
|---------|-------------|
| **macOS Custom Title Bar** | Draggable overlay header replaces the legacy macOS title bar for consistent screen-space use; Linux/Windows unaffected |
| **Session Source Filter** | Filter sessions by where they were created — CLI, VS Code, or Desktop — using Claude Code's `entrypoint` field |
| **Codex Resume Support** | Right-click "Copy Resume Command" now works for Codex sessions and prefixes `cd '<cwd>' && ` so paste-and-run lands in the original directory |
| **Pricing Accuracy** | Fixed `claude-opus-4-7` 3× overcharge; added `gpt-5.4` / `gpt-5.5` pricing with Codex cached-token handling |
| **macOS Updater Reliability** | Native OS-level relaunch fallback for the Tauri v2 macOS relaunch bug — no more "please quit and reopen" |

> Older releases: see [CHANGELOG.md](./CHANGELOG.md) for v1.12.0 and earlier.

### More

| Feature | Description |
|---------|-------------|
| **Session Context Menu** | Copy session ID, resume command, file path; delete session, show JSONL file; native rename with search integration |
| **ANSI Color Rendering** | Terminal output displayed with original ANSI colors |
| **Multi-language** | English, Korean, Japanese, Chinese (Simplified & Traditional) |
| **Recent Edits** | View file modification history and restore |
| **Auto-update** | Built-in updater with skip/postpone options |

## Installation

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

Or install directly with the full cask path:

```bash
brew install --cask jhlee0409/tap/claude-code-history-viewer
```

If you see `No Cask with this name exists`, run the full cask path command above.

To upgrade:

```bash
brew upgrade --cask claude-code-history-viewer
```

To uninstall:

```bash
brew uninstall --cask claude-code-history-viewer
```

> **Migrating from manual (.dmg) installation?**
> Remove the existing app before installing via Homebrew to avoid conflicts.
> Choose **one** installation method — do not mix manual and Homebrew installs.
> ```bash
> # Remove the manually installed app first
> rm -rf "/Applications/Claude Code History Viewer.app"
> # Then install via Homebrew
> brew tap jhlee0409/tap
> brew install --cask claude-code-history-viewer
> ```

## Build from Source

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

**Requirements**: Node.js 18+, pnpm, Rust toolchain

## Server Mode (WebUI)

Run the viewer as a headless HTTP server — no desktop environment required. Ideal for VPS, remote servers, or Docker. The server binary embeds the frontend — **a single file is all you need**.

> **New to server deployment?** See the full [Server Mode Guide](docs/server-guide.md) ([한국어](docs/server-guide.ko.md)) for step-by-step instructions covering local testing, VPS setup, Docker, and more.

### Quick Install

```bash
# Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# Or one-line script
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

Both methods install `cchv-server` to your PATH.

### Start the Server

```bash
cchv-server --serve
```

Output:

```
🔑 Auth token: b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
   Open in browser: http://192.168.1.10:3727?token=b77f41d4-ec24-4102-8f7a-8a942d6dd4a0
👁 File watcher active: /home/user/.claude/projects
🚀 WebUI server running at http://0.0.0.0:3727
```

Open the URL in your browser — the token is saved automatically.

### Pre-built Binaries

| Platform | Asset |
|----------|-------|
| Linux x64 | `cchv-server-linux-x64.tar.gz` |
| Linux ARM64 | `cchv-server-linux-arm64.tar.gz` |
| macOS ARM | `cchv-server-macos-arm64.tar.gz` |
| macOS x64 | `cchv-server-macos-x64.tar.gz` |

Download from [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases).

**CLI options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--serve` | — | **Required.** Starts the HTTP server instead of the desktop app |
| `--port <number>` | `3727` | Server port |
| `--host <address>` | `0.0.0.0` | Bind address (`127.0.0.1` for local only) |
| `--token <value>` | auto (uuid v4) | Custom authentication token |
| `--no-auth` | — | Disable authentication (not recommended for public networks) |
| `--dist <path>` | embedded | Override built-in frontend with external `dist/` directory |

### Authentication

All `/api/*` endpoints are protected by Bearer token authentication. The token is auto-generated on each server start and printed to stderr.

- **Browser access**: Use the `?token=...` URL printed at startup. The token is saved to `localStorage` automatically.
- **API access**: Include `Authorization: Bearer <token>` header.
- **Custom token**: `--token my-secret-token` to set your own.
- **Environment variable**: `CCHV_TOKEN=your-token cchv-server --serve` (useful for systemd/Docker).
- **Disable**: `--no-auth` to skip authentication entirely (only use on trusted networks).

### Real-time Updates

The server watches `~/.claude/projects/` for file changes and pushes updates to the browser via Server-Sent Events (SSE). When you use Claude Code in another terminal, the viewer updates automatically — no manual refresh needed.

### Docker

```bash
docker compose up -d
```

Check the token after startup:

```bash
docker compose logs webui
# 🔑 Auth token: ... ← paste this URL in your browser
```

The `docker-compose.yml` mounts `~/.claude`, `~/.codex`, and `~/.local/share/opencode` as read-only volumes.

### systemd Service

For persistent server on Linux, use the provided systemd template:

```bash
sudo cp contrib/cchv.service /etc/systemd/system/
sudo systemctl edit --full cchv.service   # Set User= to your username
sudo systemctl enable --now cchv.service
```

### Build from Source (Server Only)

```bash
just serve-build           # Build frontend + embed into server binary
just serve-build-run       # Build and run (embedded assets)

# Or run in development (external dist/):
just serve-dev             # Build frontend + run server with --dist
```

### Health Check

```
GET /health
→ { "status": "ok" }
```

## Usage

1. Launch the app
2. It automatically scans for conversation data from all 28 supported providers (Claude Code, Codex CLI, Gemini CLI, Cursor, Cline, Continue.dev, Goose, Zed, Qwen Code, Amazon Q CLI, and more — see the provider table above)
3. Browse projects in the left sidebar — filter by provider using the tab bar
4. Click a session to view messages
5. Use tabs to switch between Messages, Analytics, Token Stats, Recent Edits, and Session Board

### Command-line flags

Launch the app pre-focused on a specific session by passing a `--session` flag:

```bash
# Full UUID
claude-code-history-viewer --session 1265cd74-caa9-472e-b343-c4f44b5cf12c

# UUID prefix (8+ hex-or-dash chars, up to 36) — first match wins
claude-code-history-viewer --session 1265cd74

# Equals form also works
claude-code-history-viewer --session=1265cd74
```

The viewer scans every known project, navigates to the matching session, and falls back to normal startup if no session matches. Values that are neither hex-or-dash of length 8..36 nor an absolute path are silently ignored.

## Accessibility

The app includes accessibility features for keyboard-only, low-vision, and screen-reader users.

- Keyboard-first navigation:
  - Skip links for Project Explorer, Main Content, Message Navigator, and Settings
  - Project tree navigation with `ArrowUp/ArrowDown/Home/End`, type-ahead search, and `*` to expand sibling groups
  - Message navigator navigation with `ArrowUp/ArrowDown/Home/End` and `Enter` to open the focused message
- Visual accessibility:
  - Persistent global font size scaling (`90%`, `100%`, `110%`, `120%`, `130%`)
  - High contrast mode toggle in settings
- Screen reader support:
  - Landmark and tree/list semantics (`navigation`, `tree`, `treeitem`, `group`, `listbox`, `option`)
  - Live announcements for status/loading and project tree navigation/selection changes
  - Inline keyboard-help descriptions via `aria-describedby`

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | ![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white) ![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?logo=tauri&logoColor=white) |
| **Frontend** | ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) |
| **State** | ![Zustand](https://img.shields.io/badge/Zustand-433E38?logo=react&logoColor=white) |
| **Build** | ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) |
| **i18n** | ![i18next](https://img.shields.io/badge/i18next-26A69A?logo=i18next&logoColor=white) 5 languages |

## Data Privacy

**100% offline.** No conversation data is sent to any server. No analytics, no tracking, no telemetry.

Your data stays on your machine.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No Claude data found" | Make sure `~/.claude` exists with conversation history |
| Performance issues | Large histories may be slow initially — the app uses virtual scrolling |
| Update problems | If auto-updater fails, download manually from [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases) |

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Run checks before committing:
   ```bash
   pnpm tsc --build .        # TypeScript
   pnpm vitest run            # Tests
   pnpm lint                  # Lint
   ```
4. Commit your changes (`git commit -m 'feat: add my feature'`)
5. Push to the branch (`git push origin feat/my-feature`)
6. Open a Pull Request

See [Development Commands](CLAUDE.md#development-commands) for the full list of available commands.

## License

[MIT](LICENSE) — free for personal and commercial use.

---

<div align="center">

If this project helps you, consider giving it a star!

[![Star History Chart](https://api.star-history.com/svg?repos=jhlee0409/claude-code-history-viewer&type=Date)](https://star-history.com/#jhlee0409/claude-code-history-viewer&Date)

</div>
