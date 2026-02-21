<div align="center">

# Claude Code History Viewer

**Browse, search, and analyze your Claude Code conversations — all offline.**

Desktop app that reads conversation history from Claude Code, Codex CLI, and OpenCode with analytics, session boards, and real-time monitoring.

[![Version](https://img.shields.io/github/v/release/jhlee0409/claude-code-history-viewer?label=Version&color=blue)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
[![Downloads](https://img.shields.io/github/downloads/jhlee0409/claude-code-history-viewer/total?color=green)](https://github.com/jhlee0409/claude-code-history-viewer/releases)
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

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Build from Source](#build-from-source)
- [Usage](#usage)
- [Tech Stack](#tech-stack)
- [Data Privacy](#data-privacy)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider** | Unified viewer for Claude Code, Codex CLI, and OpenCode conversations |
| **Conversation Browser** | Navigate conversations by project/session with worktree grouping |
| **Global Search** | Search across all conversations instantly |
| **Analytics Dashboard** | Token usage stats and API cost calculation per provider |
| **Session Board** | Multi-session visual analysis with pixel view, attribute brushing, and activity timeline |
| **Settings Manager** | Scope-aware Claude Code settings editor with MCP server management |
| **Message Navigator** | Right-side collapsible TOC for quick conversation navigation |
| **Real-time Monitoring** | Live session file watching for instant updates |
| **Session Context Menu** | Copy session ID, resume command, file path; native rename with search integration |
| **ANSI Color Rendering** | Terminal output displayed with original ANSI colors |
| **Multi-language** | English, Korean, Japanese, Chinese (Simplified & Traditional) |
| **Recent Edits** | View file modification history and restore |
| **Auto-update** | Built-in updater with skip/postpone options |

## Installation

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Universal) | [`.dmg`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Windows (x64) | [`.exe`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |
| Linux (x64) | [`.AppImage`](https://github.com/jhlee0409/claude-code-history-viewer/releases/latest) |

### Homebrew (macOS)

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

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

## Usage

1. Launch the app
2. It automatically scans for conversation data from all supported providers (Claude Code, Codex CLI, OpenCode)
3. Browse projects in the left sidebar — filter by provider using the tab bar
4. Click a session to view messages
5. Use tabs to switch between Messages, Analytics, Token Stats, Recent Edits, and Session Board

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
