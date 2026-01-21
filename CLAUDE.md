# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Principal

Use pnpm as the package manager.

Design principles (in Korean, as requested by the project owner):
- 가독성이 높은 설계 추구
- 예측 가능성이 높은 설계 추구
- 높은 응집도 설계 추구
- 낮은 결합도 설계 추구

## Project Overview

Claude Code History Viewer is a Tauri v2 desktop application for browsing and analyzing Claude Code conversation history stored in `~/.claude`. Built with Rust backend and React/TypeScript frontend.

## Development Commands

This project uses `just` (a command runner) instead of npm scripts. Install with `brew install just` or `cargo install just`.

```bash
just setup          # Install dependencies and configure build environment
just dev            # Run full Tauri app in development mode (hot reload)
just lint           # Run ESLint
just tauri-build    # Build production app (macOS universal binary, Linux native)
just test           # Run vitest in watch mode
just test-run       # Run tests once with verbose output
```

Direct commands (if just is unavailable):
```bash
pnpm install                                    # Install dependencies
pnpm exec tauri dev                             # Development mode
pnpm exec tauri build --target universal-apple-darwin  # macOS build
pnpm exec tauri build                           # Linux build
```

## Architecture

### Data Flow
```
~/.claude/projects/[project]/*.jsonl → Rust Backend → Tauri IPC → React Frontend → Virtual List
```

### Frontend (React + TypeScript + Tailwind CSS)

**State Management**: Zustand store in `src/store/useAppStore.ts` - single store pattern with actions for projects, sessions, messages, search, and analytics.

**Key Components**:
- `src/App.tsx` - Main app shell, view routing (messages/analytics/tokenStats/recentEdits)
- `src/components/MessageViewer.tsx` - Virtual scrolling message list with search navigation
- `src/components/ProjectTree.tsx` - Sidebar with project/session hierarchy
- `src/components/contentRenderer/` - 20+ renderers for different Claude content types (tool_use, thinking, web_search, MCP, etc.)
- `src/components/messageRenderer/` - Message-level rendering (assistant details, tool results, system messages)
- `src/components/toolResultRenderer/` - Tool execution result visualization (file edits, terminal output, git operations)

**Performance**: Uses `@tanstack/react-virtual` for virtualized scrolling of large message lists. Components are memoized. FlexSearch provides fast client-side search indexing.

**i18n**: react-i18next with 5 languages (en, ko, ja, zh-CN, zh-TW). Translations in `src/i18n/locales/`.

### Backend (Rust + Tauri v2)

**Command Modules** in `src-tauri/src/commands/`:
- `project.rs` - `scan_projects`, `get_claude_folder_path`, `validate_claude_folder`
- `session.rs` - `load_project_sessions`, `load_session_messages`, `search_messages`, `get_recent_edits`, `restore_file`
- `stats.rs` - Token statistics, project summaries, activity heatmaps, session comparisons
- `update.rs` / `secure_update.rs` - GitHub release checking and update verification
- `feedback.rs` - User feedback submission

**Data Model**: `src-tauri/src/models.rs` defines Rust structs matching JSONL format.

### JSONL Message Structure

Messages are stored in `~/.claude/projects/[project-name]/*.jsonl`, one JSON object per line:

```json
{
  "uuid": "unique-id",
  "parentUuid": "parent-id",
  "sessionId": "session-uuid",
  "timestamp": "2025-06-26T11:45:51.979Z",
  "type": "user | assistant | system | summary",
  "message": {
    "role": "user | assistant",
    "content": "string" | [ContentItem...],
    "model": "claude-opus-4-20250514",
    "usage": { "input_tokens": 123, "output_tokens": 456 }
  },
  "toolUse": { ... },
  "toolUseResult": { ... },
  "isSidechain": false
}
```

TypeScript types in `src/types/index.ts` mirror this structure.

## Key Patterns

- Tauri commands are async, return `Result<T, String>`, invoked via `@tauri-apps/api/core`
- All file paths passed to Rust must be absolute
- Custom colors defined in `src/constants/colors.ts` (Claude brand colors)
- Message content can be string or `ContentItem[]` array - check type before rendering
- `isSidechain` messages are branched conversations, filtered by default

## Content Types Supported

The app renders 20+ content types from Claude API responses:
- `text`, `tool_use`, `tool_result`, `thinking`, `redacted_thinking`
- `image`, `document`, `search_result`
- `server_tool_use`, `web_search_tool_result`
- `mcp_tool_use`, `mcp_tool_result`
- Beta types: `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, `tool_search_tool_result`

When adding new content types, create a renderer in `src/components/contentRenderer/` and register it in `ClaudeContentArrayRenderer.tsx`.
