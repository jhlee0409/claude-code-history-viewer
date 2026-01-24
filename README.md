# Claude Code History Viewer

Desktop app to browse Claude Code conversation history stored in `~/.claude`.

🌐 [Website](https://jhlee0409.github.io/claude-code-history-viewer/) | 📦 [Download](https://github.com/jhlee0409/claude-code-history-viewer/releases)

![Version](https://img.shields.io/badge/Version-1.1.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

## Screenshots

<p align="center">
  <img width="49%" alt="Conversation History" src="https://github.com/user-attachments/assets/9a18304d-3f08-4563-a0e6-dd6e6dfd227e" />
  <img width="49%" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/0f869344-4a7c-4f1f-9de3-701af10fc255" />
</p>
<p align="center">
  <img width="49%" alt="Token Statistics" src="https://github.com/user-attachments/assets/d30f3709-1afb-4f76-8f06-1033a3cb7f4a" />
  <img width="49%" alt="Recent Edits" src="https://github.com/user-attachments/assets/8c9fbff3-55dd-4cfc-a135-ddeb719f3057" />
</p>

## Features

- **Browse**: Navigate conversations by project/session
- **Search**: Search messages across all conversations
- **Analytics**: Token usage stats and API cost calculation
- **Multi-language**: English, Korean, Japanese, Chinese
- **Recent edits**: View file modification history and restore
- **Others**: Auto-update, folder selection, feedback

## Installation

Download for your platform from [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases).

## Build from source

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
2. It automatically scans `~/.claude` for conversation data
3. Browse projects in the left sidebar
4. Click a session to view messages
5. Use tabs to switch between Messages, Analytics, Token Stats, and Recent Edits

## Data privacy

Runs locally only. No conversation data sent to servers.

Anonymous usage analytics (app launches, feature usage) are collected via [Aptabase](https://aptabase.com/) to improve the app. No conversation content or personal information is tracked.

## Troubleshooting

**"No Claude data found"**: Make sure `~/.claude` exists with conversation history.

**Performance issues**: Large conversation histories may be slow initially. The app uses virtual scrolling to handle this.

**Update problems**: If auto-updater fails, download manually from [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases).

## Tech stack

- **Backend**: Rust + Tauri v2
- **Frontend**: React 19, TypeScript, Tailwind CSS, Zustand
- **Build**: Vite, just

## License

MIT License - see [LICENSE](LICENSE).

---

[Open an issue](https://github.com/jhlee0409/claude-code-history-viewer/issues) for questions or bug reports.
