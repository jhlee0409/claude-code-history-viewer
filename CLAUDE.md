# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

If the user's prompt starts with “EP:”, then the user wants to enhance the prompt. Read the PROMPT_ENHANCER.md file and follow the guidelines to enhance the user's prompt. Show the user the enhancement and get their permission to run it before taking action on the enhanced prompt.

The enhanced prompts will follow the language of the original prompt (e.g., Korean prompt input will output Korean prompt enhancements, English prompt input will output English prompt enhancements, etc.)

## Principal

First, You must use command "gemini -p {prompt}" and then use the result that returned response
Use pnpm Package Manager

가독성이 높은 설계 추구
예측 가능성이 높은 설계 추구
높은 응집도 설계 추구
낮은 결합도 설계 추구

## Project Overview

Claude Code History Viewer is a Tauri-based desktop application that allows users to browse and analyze conversation history from multiple AI coding assistants: Claude Code (`~/.claude`), Codex CLI (`~/.codex`), and OpenCode (`~/.local/share/opencode/`).

## Development Commands

This project uses `just` (a command runner). Install with `brew install just` or `cargo install just`.

### Recommended (using just)

```bash
just setup          # Install dependencies and configure build environment
just dev            # Run full Tauri app in development mode (hot reload)
just lint           # Run ESLint
just tauri-build    # Build production app (macOS universal binary, Linux native)
just test           # Run vitest in watch mode
just test-run       # Run tests once with verbose output
just sync-version   # Sync version from package.json to Cargo.toml and tauri.conf.json
```

### Alternative (using pnpm directly)

```bash
pnpm install                                    # Install dependencies
pnpm exec tauri dev                             # Development mode
pnpm exec tauri build --target universal-apple-darwin  # macOS build
pnpm exec tauri build                           # Linux/Windows build
pnpm dev                                        # Start Vite dev server only
pnpm build                                      # Build frontend with TypeScript checking
pnpm lint                                       # Run ESLint
```

## Version Management

This is a **Tauri desktop application** distributed via GitHub Releases (not npm).

### Single Source of Truth

**`package.json`** is the single source of truth for version numbers.

```
package.json (원본)
    ↓ just sync-version
├── src-tauri/Cargo.toml
└── src-tauri/tauri.conf.json
```

### Version Bump Guide

```bash
# 방법 1: npm version 사용 (npm 배포 아님, 버전 번호만 변경)
npm version prerelease --preid=beta --no-git-tag-version
# package.json: 1.0.0-beta.4 → 1.0.0-beta.5

# 방법 2: 수동으로 package.json 편집
# "version": "1.0.0-beta.5"

# 버전 동기화 (필수)
just sync-version
```

### Release Process

#### Phase 1: 품질 검증 (Quality Gate)

릴리즈 전 **모든 검증을 통과**해야 한다. 하나라도 실패하면 수정 후 재검증.

```bash
# ===== Frontend 검증 =====
pnpm install                    # 의존성 동기화 (lockfile 불일치 방지)
pnpm tsc --build .              # TypeScript 빌드 체크 (CI와 동일)
pnpm vitest run --reporter=verbose  # 프론트엔드 테스트
pnpm lint                       # ESLint (no-explicit-any 등)

# ===== Backend 검증 =====
cd src-tauri && cargo test -- --test-threads=1 && cd ..  # Rust 테스트 (단일 스레드 필수)
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cd ..  # Rust 린트
cd src-tauri && cargo fmt --all -- --check && cd ..      # Rust 포맷 체크

# ===== i18n 검증 =====
pnpm run i18n:validate          # 5개 언어 키 동기화 확인 (en, ko, ja, zh-CN, zh-TW)
```

**주의사항:**
- `cargo test`는 반드시 `--test-threads=1`로 실행 (settings 테스트가 `env::set_var("HOME")` 사용)
- `pnpm install` 생략 시 lockfile과 node_modules 불일치로 빌드 실패 가능
- lint에서 `@typescript-eslint/no-explicit-any` 에러 발생 시 `as unknown as TargetType` 패턴 사용

#### Phase 2: 변경사항 분석 및 버전 결정

```bash
# 마지막 릴리즈 이후 커밋 수 확인
git log $(git tag --sort=-version:refname | head -1)..HEAD --oneline | wc -l

# 변경사항 요약 확인
git log $(git tag --sort=-version:refname | head -1)..HEAD --oneline
```

**버전 결정 기준 (SemVer):**
| 변경 유형 | 버전 | 예시 |
|-----------|------|------|
| 버그 수정만 | patch (x.y.Z) | 1.3.0 → 1.3.1 |
| 새 기능 추가 | minor (x.Y.0) | 1.3.0 → 1.4.0 |
| 호환성 깨지는 변경 | major (X.0.0) | 1.3.0 → 2.0.0 |

#### Phase 3: 버전 범프 및 커밋

```bash
# 1. 버전 업데이트
npm version <version> --no-git-tag-version
# 예: npm version 1.3.1 --no-git-tag-version

# 2. 버전 동기화 (package.json → Cargo.toml + tauri.conf.json)
just sync-version

# 3. 최종 빌드 확인 (동기화 후 Cargo.toml 변경 반영)
pnpm tsc --build . && pnpm vitest run

# 4. 커밋 및 태그
git add -A
git commit -m "chore: release v1.3.1"
git tag v1.3.1
git push && git push --tags
```

#### Phase 4: 릴리즈 발행 확인

태그 푸시 후 GitHub Actions (`updater-release.yml`)가 자동 실행:
1. 멀티플랫폼 빌드 (macOS universal, Windows x64, Linux x64)
2. `latest.json` 생성 (Tauri 업데이터용, 서명 포함)
3. GitHub Release 발행 (자동 릴리즈 노트)

```bash
# 워크플로우 상태 확인
gh run list --workflow=updater-release.yml --limit=1

# 릴리즈 확인
gh release view v1.3.1

# 릴리즈 노트 수동 업데이트 (필요시)
gh release edit v1.3.1 --notes-file /path/to/notes.md
```

**릴리즈 후 확인사항:**
- [ ] 3개 플랫폼 바이너리 모두 첨부됨 (.dmg, .exe, .AppImage)
- [ ] `latest.json`이 첨부됨 (자동 업데이트용)
- [ ] `latest.json` 내 `platforms` 에 darwin-aarch64, darwin-x86_64, linux-x86_64, windows-x86_64 포함
- [ ] 각 플랫폼의 `.sig` 서명 파일 존재
- [ ] **README.md 업데이트** — 새 기능, 변경된 스크린샷, 버전 배지 등 반영

#### 트러블슈팅

| 문제 | 원인 | 해결 |
|------|------|------|
| CI에서 pnpm 버전 충돌 | `pnpm/action-setup`의 `version` 필드와 `package.json`의 `packageManager` 충돌 | 워크플로우에서 `version` 제거 (packageManager 자동 감지) |
| `cargo test` 간헐적 실패 | `env::set_var("HOME")`이 프로세스 전역 → 병렬 실행 시 경쟁 | `--test-threads=1` 사용 |
| 릴리즈 중복 생성 | 수동 `gh release create` + 워크플로우 자동 생성 | 수동 생성 금지, 워크플로우에 위임 |
| 자동 업데이트 시 에러 플래시 | `relaunch()` 전 바이너리 교체로 UI 크래시 | `isRestarting` 상태로 오버레이 표시 후 500ms 딜레이 |
| `pnpm install` 후에도 모듈 못 찾음 | lockfile과 실제 node_modules 불일치 | `rm -rf node_modules && pnpm install` |

### Auto-Update System

- **업데이트 체크**: `src-tauri/src/commands/update.rs`
- **프론트엔드 훅**: `src/hooks/useGitHubUpdater.ts`, `src/hooks/useSmartUpdater.ts`
- **Tauri 설정**: `src-tauri/tauri.conf.json` (updater plugin)
- **CI/CD**: `.github/workflows/updater-release.yml`

## Architecture

### Data Flow

```
Claude Code: ~/.claude/projects/[project]/*.jsonl  ─┐
Codex CLI:   ~/.codex/sessions/**/rollout-*.jsonl   ├→ Rust Backend → Tauri IPC → React Frontend → Virtual List
OpenCode:    ~/.local/share/opencode/storage/       ─┘
```

### Frontend (React + TypeScript)

- **State Management**: Uses Zustand store in `src/store/useAppStore.ts`
- **Components**: Located in `src/components/`
  - `MessageViewer.tsx` - Displays messages with virtual scrolling for performance
  - `ProjectTree.tsx` - Shows project/session hierarchy
  - `contentRenderer.tsx` - Handles rendering of different content types
  - `messageRenderer.tsx` - Renders tool use, tool results, and message content
- **API Integration**: Frontend communicates with Rust backend via Tauri's IPC commands
- **Virtual Scrolling**: Uses react-window for efficient rendering of large message lists

### Backend (Rust + Tauri)

- **Main Commands** (in `src-tauri/src/lib.rs`):
  - `get_claude_folder_path` - Locates user's `.claude` directory
  - `scan_projects` - Scans for all Claude projects
  - `load_project_sessions` - Loads sessions for a specific project
  - `load_session_messages` - Loads messages from a JSONL file
  - `search_messages` - Searches across all messages
- **Data Structure**: Reads JSONL files containing conversation history from `~/.claude/projects/`

## i18n Structure (Internationalization)

### File Structure (Namespace 기반)

LLM이 파악하기 좋은 namespace 기반 구조로 분리됨 (각 파일 2-40KB):

```
src/i18n/
├── index.ts                  # i18n configuration (namespace 병합)
├── useAppTranslation.ts      # Type-safe custom hook
├── types.generated.ts        # Auto-generated types (DO NOT EDIT)
└── locales/
    ├── en/                   # English (1392 keys total)
    │   ├── common.json       # 공통 UI (~99 keys)
    │   ├── analytics.json    # 분석 대시보드 (~132 keys)
    │   ├── session.json      # 세션/프로젝트 (~116 keys)
    │   ├── settings.json     # 설정 관리자 (~501 keys)
    │   ├── tools.json        # 도구 관련 (~69 keys)
    │   ├── error.json        # 에러 메시지 (~37 keys)
    │   ├── message.json      # 메시지 뷰어 (~66 keys)
    │   ├── renderers.json    # 렌더러 컴포넌트 (~255 keys)
    │   ├── update.json       # 업데이트 관련 (~65 keys)
    │   ├── feedback.json     # 피드백 (~32 keys)
    │   └── recentEdits.json  # 최근 편집 (~20 keys)
    ├── ko/                   # Korean (동일 구조)
    ├── ja/                   # Japanese (동일 구조)
    ├── zh-CN/                # Simplified Chinese (동일 구조)
    └── zh-TW/                # Traditional Chinese (동일 구조)
```

### Namespace 구조의 장점

1. **LLM 친화적**: 각 namespace 파일이 단일 컨텍스트에서 처리 가능한 크기
2. **관심사 분리**: 특정 기능 수정 시 해당 namespace 파일만 변경
3. **병렬 번역 가능**: 여러 기능을 독립적으로 번역 작업 가능
4. **기존 호환성**: `t('prefix.key')` 형식 그대로 동작

### Key Structure (Flat with Dot Notation)

각 namespace 파일 내에서 dot notation 사용:

```json
// locales/en/common.json
{
  "common.appName": "Claude Code History Viewer",
  "common.loading": "Loading...",
  "common.cancel": "Cancel"
}

// locales/en/analytics.json
{
  "analytics.dashboard": "Analytics Dashboard",
  "analytics.tokenUsage": "Token Usage"
}
```

### Namespace → Prefix 매핑

| Namespace | 포함 Prefix | Keys |
|-----------|-------------|------|
| `common` | common, status, time, copyButton | ~99 |
| `analytics` | analytics | ~132 |
| `session` | session, project | ~116 |
| `settings` | settingsManager, settings, folderPicker | ~501 |
| `tools` | tools, toolResult, toolUseRenderer, collapsibleToolResult | ~69 |
| `error` | error | ~37 |
| `message` | message, messages, messageViewer, messageContentDisplay | ~66 |
| `renderers` | advancedTextDiff, agentProgressGroup, agentTaskGroup, assistantMessageDetails, bashCodeExecutionToolResultRenderer, captureMode, citationRenderer, claudeContentArrayRenderer, claudeSessionHistoryRenderer, claudeToolUseDisplay, codeExecutionToolResultRenderer, codebaseContextRenderer, commandOutputDisplay, commandRenderer, contentArray, diffViewer, fileContent, fileEditRenderer, fileHistorySnapshotRenderer, fileListRenderer, gitWorkflowRenderer, globalSearch, imageRenderer, mcpRenderer, progressRenderer, queueOperationRenderer, structuredPatch, summaryMessageRenderer, systemMessageRenderer, taskNotification, taskOperation, terminalStreamRenderer, textEditorCodeExecutionToolResultRenderer, thinkingRenderer, toolSearchToolResultRenderer, webFetchToolResultRenderer, webSearchRenderer | ~255 |
| `update` | updateModal, updateSettingsModal, simpleUpdateModal 등 | ~65 |
| `feedback` | feedback | ~32 |
| `recentEdits` | recentEdits | ~20 |

### Usage in Components

```typescript
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('common.appName')}</h1>
      <p>{t('session.title')}</p>
      <button>{t('common.cancel')}</button>
    </div>
  );
};
```

### i18n Scripts

```bash
pnpm run generate:i18n-types  # Regenerate types after adding keys
pnpm run i18n:validate        # Validate keys across all languages
pnpm run i18n:sync            # Sync keys across all languages
```

### Adding New Messages

1. **해당 namespace의 모든 언어 파일에 키 추가**:
   ```json
   // locales/en/common.json
   { "common.newKey": "New feature text" }

   // locales/ko/common.json
   { "common.newKey": "새 기능 텍스트" }
   // ... repeat for ja, zh-CN, zh-TW
   ```

2. **타입 재생성**:
   ```bash
   pnpm run generate:i18n-types
   ```

3. **검증**:
   ```bash
   pnpm run i18n:validate
   ```

### Adding New Language

1. 새 언어 디렉토리 생성 및 en 디렉토리 복사: `cp -r locales/en locales/es`
2. 각 namespace 파일 번역
3. `src/i18n/index.ts`에 언어 추가 (모든 namespace import)

### Key Sync Verification

```bash
# 검증 스크립트 실행
node scripts/validate-i18n.mjs
```

## Raw Message Structure

The application reads `.jsonl` files where each line is a JSON object representing a single message. The core structure is as follows:

```json
{
  "uuid": "...",
  "parentUuid": "...",
  "sessionId": "...",
  "timestamp": "...",
  "type": "user" | "assistant" | "system" | "summary",
  "message": { ... },
  "toolUse": { ... },
  "toolUseResult": { ... },
  "isSidechain": false
}
```

### The `message` Field

The `message` field is a nested JSON object. Its structure varies depending on the message `type`.

**For `user` messages:**

```json
{
  "message": {
    "role": "user",
    "content": "..." // or ContentItem[]
  }
}
```

**For `assistant` messages:**

Assistant messages contain additional metadata within the `message` object:

```json
{
  "message": {
    "id": "msg_...",
    "role": "assistant",
    "model": "claude-opus-4-20250514",
    "content": [...],
    "stop_reason": "tool_use" | "end_turn" | null,
    "usage": {
      "input_tokens": 123,
      "output_tokens": 456,
      "cache_creation_input_tokens": 20238,
      "cache_read_input_tokens": 0,
      "service_tier": "standard"
    }
  }
}
```

- **`id`, `model`, `stop_reason`, `usage`**: These fields are typically present only in assistant messages.
- **`usage` object**: Contains detailed token counts, including cache-related metrics.

## Key Implementation Details

- The app expects Claude conversation data in `~/.claude/projects/[project-name]/*.jsonl`
- Each JSONL file represents a session with one JSON message per line
- Messages can contain tool use results and error information
- The UI is primarily in Korean.션, etc.)
- Virtual scrolling is implemented for performance with large message lists
- Pagination is used to load messages in batches (100 messages per page)
- Message tree structure is flattened for virtual scrolling while preserving parent-child relationships
- No test suite currently exists

## Important Patterns

- Tauri commands are async and return `Result<T, String>`
- Frontend uses `@tauri-apps/api/core` for invoking backend commands
- All file paths must be absolute when passed to Rust commands
- The app uses Tailwind CSS with custom Claude brand colors defined in `tailwind.config.js`
- Message components are memoized for performance
- AutoSizer is used for responsive virtual scrolling
- Message height is dynamically calculated and cached for variable height scrolling

## Claude Directory Structure Analysis

### Directory Structure

```text
~/.claude/
├── projects/          # Contains project-specific conversation data
│   └── [project-name]/
│       └── *.jsonl    # JSONL files with conversation messages
├── ide/              # IDE-related data
├── statsig/          # Statistics/analytics data
└── todos/            # Todo list data
```

### JSONL Message Format

Each JSONL file contains one JSON object per line. The actual structure differs from what the frontend expects:

#### Raw Message Structure (in JSONL files)

This is the corrected structure based on analysis of the `.jsonl` files.

```json
{
  "uuid": "unique-message-id",
  "parentUuid": "uuid-of-parent-message",
  "sessionId": "session-uuid",
  "timestamp": "2025-06-26T11:45:51.979Z",
  "type": "user | assistant | system | summary",
  "isSidechain": false,
  "cwd": "/path/to/working/directory",
  "version": "1.0.35",
  "requestId": "request-id-from-assistant",
  "userType": "external",
  "message": {
    "role": "user | assistant",
    "content": "..." | [],
    "id": "msg_...",
    "model": "claude-opus-4-20250514",
    "stop_reason": "tool_use",
    "usage": { "input_tokens": 123, "output_tokens": 456 }
  },
  "toolUse": {},
  "toolUseResult": "..." | {}
}
```

**Note:** The fields `parentUuid`, `isSidechain`, `cwd`, `version`, `requestId`, `userType`, `toolUse`, `toolUseResult` are optional. The fields `id`, `model`, `stop_reason`, `usage` are specific to assistant messages and are also optional.

### Content Types

#### 1. User Message Content Types

**Simple String Content**

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "더 고도화할 부분은 없을까?"
  }
}
```

**Array Content with tool_result**

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01VDVUHPae8mbcpER7tbbHvd",
        "type": "tool_result",
        "content": "file content here..."
      }
    ]
  }
}
```

**Array Content with text type**

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Please analyze this codebase..."
      }
    ]
  }
}
```

**Command Messages**

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>"
  }
}
```

#### 2. Assistant Message Content Types

**Text Content**

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "I'll help you fix these Rust compilation errors..."
      }
    ]
  }
}
```

**Tool Use Content**

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01QUa384MpVwU4F8tuF8hg9T",
        "name": "TodoWrite",
        "input": {
          "todos": [...]
        }
      }
    ]
  }
}
```

**Thinking Content**

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "thinking",
        "thinking": "사용자가 메시지 객체의 내용이 null이고...",
        "signature": "EpUICkYIBRgCKkCB6bsN5FuO+M1gLbr..."
      }
    ]
  }
}
```

#### 3. Tool Use Result Structures

**File Read Results**

```json
{
  "toolUseResult": {
    "type": "text",
    "file": {
      "filePath": "/Users/jack/client/ai-code-tracker/package.json",
      "content": "{\n  \"name\": \"ai-code-tracker\"...",
      "numLines": 59,
      "startLine": 1,
      "totalLines": 59
    }
  }
}
```

**Command Execution Results**

```json
{
  "toolUseResult": {
    "stdout": "> ai-code-tracker@0.6.0 lint\n> eslint src --fix",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  }
}
```

**Error Results**

```json
{
  "message": {
    "content": [
      {
        "type": "tool_result",
        "content": "Error: The service was stopped\n    at ...",
        "is_error": true,
        "tool_use_id": "toolu_01PKwT3i8u1ryjWZpMBWmDjX"
      }
    ]
  }
}
```

**Todo List Results**

```json
{
  "toolUseResult": {
    "oldTodos": [...],
    "newTodos": [...]
  }
}
```

**Multi-Edit Results**

```json
{
  "toolUseResult": {
    "filePath": "/Users/jack/client/ai-code-tracker/src/extension.ts",
    "edits": [
      {
        "old_string": "...",
        "new_string": "...",
        "replace_all": false
      }
    ],
    "originalFileContents": "..."
  }
}
```

#### 4. Special Message Types

**Summary Messages**

```json
{
  "type": "summary",
  "summary": "AI Code Tracker: Comprehensive VS Code Extension Analysis",
  "leafUuid": "28f1d1f6-3485-48a6-9408-723624bc1e42"
}
```

### Message Metadata Fields

- `parentUuid`: Links to parent message in conversation tree
- `isSidechain`: Boolean indicating if this is a sidechain conversation
- `userType`: Usually "external" for user messages
- `cwd`: Current working directory when message was sent
- `sessionId`: Unique session identifier
- `version`: Claude client version
- `timestamp`: ISO 8601 timestamp
- `uuid`: Unique message identifier
- `requestId`: Present in assistant messages

### Content Rendering Status

Currently Supported:

- ✅ Text content (`type: "text"`) - with citations support
- ✅ Tool use (`type: "tool_use"`)
- ✅ Tool results (`type: "tool_result"`)
- ✅ Command messages (within text content)
- ✅ Thinking content (`type: "thinking"`)
- ✅ Redacted thinking (`type: "redacted_thinking"`) - encrypted by safety systems
- ✅ Image content (`type: "image"`) - base64 and URL sources
- ✅ Server tool use (`type: "server_tool_use"`) - e.g., web_search
- ✅ Web search results (`type: "web_search_tool_result"`)
- ✅ Document content (`type: "document"`) - PDF and plain text
- ✅ Search results (`type: "search_result"`)
- ✅ MCP tool use (`type: "mcp_tool_use"`) - Model Context Protocol tool calls
- ✅ MCP tool result (`type: "mcp_tool_result"`) - MCP tool execution results
- ✅ Citations - inline source references

2025 Beta Content Types:
- ✅ Web fetch result (`type: "web_fetch_tool_result"`) - Full page/PDF content retrieval (beta: web-fetch-2025-09-10)
- ✅ Code execution result (`type: "code_execution_tool_result"`) - Legacy Python execution (beta: code-execution-2025-08-25)
- ✅ Bash execution result (`type: "bash_code_execution_tool_result"`) - Bash command execution (beta: code-execution-2025-08-25)
- ✅ Text editor result (`type: "text_editor_code_execution_tool_result"`) - File operations (beta: code-execution-2025-08-25)
- ✅ Tool search result (`type: "tool_search_tool_result"`) - MCP tool discovery (beta: mcp-client-2025-11-20)

Message-level Metadata (2025):
- ✅ `costUSD` - API usage cost
- ✅ `durationMs` - Response latency

### Recent Updates

- **2025 Beta Content Types Support (January 2026)**:
  - Added 5 new beta content type renderers:
    - `WebFetchToolResultRenderer` - Web page/PDF content retrieval
    - `CodeExecutionToolResultRenderer` - Legacy Python code execution
    - `BashCodeExecutionToolResultRenderer` - Bash command execution
    - `TextEditorCodeExecutionToolResultRenderer` - File view/create/edit/delete operations
    - `ToolSearchToolResultRenderer` - MCP tool discovery results
  - Added shared `safeStringify` utility in `src/utils/jsonUtils.ts`
  - Memoized `ClaudeContentArrayRenderer` for performance
- **2025 Content Types Support (December 2025)**:
  - Added support for new content types from Claude API 2025 updates
  - Implemented `redacted_thinking`, `server_tool_use`, `web_search_tool_result`, `document`, `search_result` renderers
  - Added `CitationRenderer` for inline source references
  - Added `costUSD` and `durationMs` fields to message metadata
  - Enhanced `AssistantMessageDetails` to display cost and duration metrics
- **Data Structure & Type Correction (June 2025)**:
  - Performed a deep analysis of `.jsonl` log files in the `~/.claude` directory to verify the exact data structure.
  - Added a `Raw Message Structure` section to this document to accurately model the nested `message` object and include assistant-specific metadata (`id`, `model`, `stop_reason`, `usage`).
  - Updated the corresponding Rust structs in `src-tauri/src/commands.rs` and TypeScript interfaces in `src/types/index.ts` to align with the true data format, enhancing type safety and preventing data loss during parsing.
- **Virtual Scrolling Implementation**: Added react-window with VariableSizeList for efficient rendering of large message lists
- **Performance Optimizations**:
  - Messages are memoized to prevent unnecessary re-renders
  - Dynamic height calculation for variable content sizes
  - AutoSizer for responsive viewport handling
  - Infinite scroll with react-window-infinite-loader
- **Type System Updates**:
  - Fixed ContentItem[] type support in ClaudeMessage interface
  - Added proper TypeScript types for virtual scrolling components
  - Updated messageAdapter to use type-only imports

### Dependencies Added

- `react-window` - Virtual scrolling for performance
- `react-window-infinite-loader` - Infinite scroll support
- `react-virtualized-auto-sizer` - Responsive height calculation
- `@types/react-window` - TypeScript definitions
- `@types/react-window-infinite-loader` - TypeScript definitions

### Known Issues

- The frontend expects content at the root level, but it's actually nested under `message.content`
- Thinking content appears both as a separate type and as tags within text
- Image support is defined in the data structure but not implemented in the UI
- ESLint configuration uses deprecated .eslintignore (migrated to ignores in config)

## Code Quality Checklist (PR #78 리뷰 기반)

코드 작성 시 아래 항목을 반드시 준수한다. 이 체크리스트는 PR #78에서 반복 발견된 34건의 리뷰 이슈를 예방하기 위한 것이다.

### 보안
- 사용자 입력 ID를 파일 경로에 사용할 때 → `^[A-Za-z0-9_-]+$` 검증 필수
- 파일 쓰기 → temp 파일 + rename 패턴(원자적 쓰기)
- Rust에서 디렉토리 순회 시 symlink 차단

### 에러 처리
- 모든 `async/await` → try/catch + 사용자에게 보이는 피드백 (toast/alert). `console.error`만은 부족
- 다단계 저장 → 모든 파싱/검증을 먼저 완료한 후 적용
- 필수 매개변수(`projectPath` 등) → 함수 시작부에 가드 배치

### i18n
- 새 키 추가 → 5개 locale 파일(en, ko, ja, zh-CN, zh-TW) 모두 동시 업데이트
- JSON 중복 키 절대 금지 — `pnpm run i18n:validate`로 검증
- TSX 내 사용자에게 보이는 문자열 → 반드시 `t()` 래핑

### 접근성 (a11y)
- 아이콘 전용 버튼 → `aria-label` 필수
- Dialog → `DialogTitle` 또는 `aria-label` 필수
- `Label`-`Input` 쌍 → `htmlFor`/`id` 연결, ID는 `React.useId()`
- `TooltipTrigger` → 포커스 가능한 요소(`<button>`)로 감싸기

### React 상태 관리
- `setState` 직후 해당 상태를 읽지 말 것 → 값을 인자로 직접 전달하거나 `useEffect` 사용
- 커스텀 훅 내부에서 다른 커스텀 훅 호출 → 인스턴스 분리 문제 주의

### 크로스 플랫폼
- 경로 split → `split(/[\\/]/)` (Windows `\` 대응)
- Rust `fs::rename` → Windows에서 대상 존재 시 실패, `remove_file` 후 rename
- 홈 디렉토리 감지 → `C:\Users\` 패턴 포함

### 기타
- 유틸리티 함수 작성 전 → 기존 utils에 동일 기능 있는지 확인
- null 체크 → `!= null`(loose equality)로 null+undefined 동시 처리
- `localStorage` 접근 → 항상 try/catch
