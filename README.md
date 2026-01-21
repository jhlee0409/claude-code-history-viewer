# Claude Code History Viewer

A desktop app to browse and search your Claude Code conversation history stored in `~/.claude`.

![Version](https://img.shields.io/badge/Version-1.0.0--beta.4-orange.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> **Beta software** - Things might break or change

## Why this exists

Claude Code stores conversation history in JSONL files scattered across `~/.claude/projects/`. These are hard to read and search through. This app gives you a proper interface to browse your conversations, see usage stats, and find old discussions.

## Screenshots

### Main Interface

Browse projects and view conversations with syntax-highlighted code blocks

<p align="center">
  <img width="49%" alt="Main Interface 1" src="https://github.com/user-attachments/assets/45719832-324c-40c3-8dfe-5c70ddffc0a9" />
  <img width="49%" alt="Main Interface 2" src="https://github.com/user-attachments/assets/bb9fbc9d-9d78-4a95-a2ab-a1b1b763f515" />
</p>

### Analytics Dashboard

Activity heatmap and tool usage statistics

<img width="720" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/77dc026c-8901-47d1-a8ca-e5235b97e945" />

### Token Statistics

Per-project and per-session token usage breakdown

<img width="720" alt="Token Statistics" src="https://github.com/user-attachments/assets/ec5b17d0-076c-435e-8cec-1c6fd74265db" />

## Features

- **Browse conversations** - Project tree on the left, conversation view on the right
- **Search** - Fast client-side search with FlexSearch indexing
- **Analytics** - Token usage, activity heatmaps, tool usage statistics
- **Recent edits** - View and recover recent file changes made by Claude
- **Rich content rendering** - Syntax-highlighted code, diffs, tool outputs, thinking blocks, web search results, MCP tool calls
- **Virtual scrolling** - Handles large conversation histories without freezing
- **Multi-language UI** - English, Korean, Japanese, Simplified Chinese, Traditional Chinese

## Installation

### Download

Get the latest release from [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases).

### Build from source

**Requirements**: Node.js 18+, pnpm, Rust toolchain, and:
- macOS: Xcode Command Line Tools
- Linux: WebKit and GTK libraries (see [LINUX_BUILD.md](LINUX_BUILD.md))

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# Install just (command runner)
brew install just    # macOS
# or: cargo install just

# Setup and run
just setup
just dev
```

#### Without just

```bash
pnpm install
rustup target add x86_64-apple-darwin  # macOS only
pnpm exec tauri dev
```

#### Build for production

```bash
just tauri-build
# Output: src-tauri/target/release/bundle/
```

## Usage

1. Launch the app
2. It automatically scans `~/.claude` for conversation data
3. Browse projects in the left sidebar
4. Click a session to view messages
5. Use the tabs to switch between Messages, Analytics, Token Stats, and Recent Edits

## Data privacy

Everything runs locally. No data leaves your machine. The app only reads files from `~/.claude`.

## Expected directory structure

```
~/.claude/
└── projects/
    └── [project-name]/
        └── *.jsonl    # Conversation files
```

## Troubleshooting

**"No Claude data found"**: Check that `~/.claude` exists and contains conversation history from Claude Code.

**Slow initial load**: First run compiles Rust dependencies (~1-2 minutes). Subsequent launches are fast.

## Tech stack

- **Backend**: Rust + Tauri v2
- **Frontend**: React 19, TypeScript, Tailwind CSS, Zustand, Radix UI
- **Build**: Vite, just

## License

MIT License - see [LICENSE](LICENSE).

---

[Open an issue](https://github.com/jhlee0409/claude-code-history-viewer/issues) for questions or bug reports.
