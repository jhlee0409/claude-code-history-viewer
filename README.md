A desktop app to browse and search your Claude Code conversation history stored in `~/.claude`.

![Version](https://img.shields.io/badge/Version-1.0.0--beta.3-orange.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-lightgrey.svg)

**Languages**: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md)

> ⚠️ **Beta software** - Things might break or change

## Why this exists

Claude Code stores conversation history in JSONL files scattered across `~/.claude/projects/`. These are hard to read and search through. This app gives you a proper interface to browse your conversations, see usage stats, and find old discussions.

## Screenshots & Demo

### Main Interface

Browse projects and view conversations with syntax-highlighted code blocks

<p align="center">
  <img width="49%" alt="Main Interface 1" src="https://github.com/user-attachments/assets/45719832-324c-40c3-8dfe-5c70ddffc0a9" />
  <img width="49%" alt="Main Interface 2" src="https://github.com/user-attachments/assets/bb9fbc9d-9d78-4a95-a2ab-a1b1b763f515" />
</p>

### Analytics Dashboard

Activity heatmap and tool usage statistics to understand your usage patterns

<img width="720" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/77dc026c-8901-47d1-a8ca-e5235b97e945" />

### Token Statistics

Per-project token usage breakdown and session-level analysis

<img width="720" alt="Token Statistics" src="https://github.com/user-attachments/assets/ec5b17d0-076c-435e-8cec-1c6fd74265db" />

### Demo

<img width="720" alt="Demo" src="https://github.com/user-attachments/assets/d3ea389e-a912-433e-b6e2-2e895eaa346d" />

## What it does

**Browse conversations**: Navigate through projects and sessions with a file tree on the left, conversation view on the right.

**Search and filter**: Find specific conversations or messages across your entire history.

**Usage analytics**: See which projects you use most, token usage over time, and activity patterns. Useful for understanding your Claude Code habits.

**Better reading experience**: Syntax highlighted code blocks, properly formatted diffs, and readable message threads instead of raw JSONL.

**Tool output visualization**: Web search results, git operations, and terminal output are displayed in a readable format.

The app also handles large conversation histories without freezing up, and auto-refreshes when new conversations are added.

## Installation

### Download

Get the latest version from [Releases](https://github.com/jhlee0409/claude-code-history-viewer/releases).

### Build from source

#### macOS
```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
pnpm install
pnpm tauri:build
```

**Requirements**: Node.js 18+, pnpm, Rust toolchain, Xcode Command Line Tools

#### Linux
See [LINUX_BUILD.md](LINUX_BUILD.md) for detailed Linux build instructions.

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
pnpm install
pnpm tauri:build:linux
```

**Requirements**: Node.js 18+, pnpm, Rust toolchain, system libraries (WebKit, GTK)

## Usage

1. Launch the app
2. It automatically scans `~/.claude` for conversation data
3. Browse projects in the left sidebar
4. Click any session to view messages
5. Check the analytics tab for usage insights

## Current limitations

- **Linux and macOS support** (Windows support planned)
- **Beta software** - expect some rough edges
- Large conversation histories (thousands of messages) might be slow to load initially
- Auto-update system is still being tested

## Data privacy

Everything runs locally. No data is sent to any servers. The app only reads files from your `~/.claude` directory.

## Claude directory structure

The app expects this structure:

```
~/.claude/
├── projects/          # Project conversations
│   └── [project-name]/
│       └── *.jsonl    # Conversation files
├── ide/              # IDE data
├── statsig/          # Analytics
└── todos/            # Todo lists
```

## Troubleshooting

**"No Claude data found"**: Make sure you've used Claude Code and have some conversation history. Check that `~/.claude` exists.

**Performance issues**: Try closing other apps if you have very large conversation histories. The app loads everything into memory for now.

**Update problems**: Beta auto-updater might be flaky. Download manually from releases if needed.

## Contributing

Pull requests welcome. This is a side project so response times might vary.

## Tech stack

Built with Tauri (Rust + React). UI uses Tailwind CSS and Radix components.

## License

MIT License - see [LICENSE](LICENSE) file.

---

**Questions or issues?** [Open an issue](https://github.com/jhlee0409/claude-code-history-viewer/issues) with details about your setup and what went wrong.
