# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.22.0] - 2026-07-18

Feature release: multi-session terminal resume, a full Recent Edits diff view, richer in-session search, and two new/expanded providers (Antigravity CLI, VS Code legacy sessions).

### Added
- **Resume multiple sessions in a terminal** — multi-select sessions and open each in a new terminal window; desktop-only (hidden in WebUI `--serve` mode) with a whitelisted, per-OS terminal launcher. (#463, closes #462)
- **Recent Edits diff view** — expand a file edit into a full added/removed diff, with clickable +N/−N stats to jump straight to added or removed lines. (#473)
- **"Reveal in folder" for edited files** — open the containing folder from a Recent Edits row (Finder/Explorer/file manager); shown only for real absolute paths in the desktop app. (#475)
- **Antigravity CLI provider** — reads Google's `~/.gemini/antigravity-cli/` conversation store (history index + per-session transcripts), following its move away from the legacy `gemini-cli`. (#470, closes #452)
- **Structured AskUserQuestion rendering** — the tool now renders CLI-style (question, header, and each option's label/description, single/multi-select) instead of raw JSON. (#481)

### Fixed
- **In-session search misses inside collapsed tool cards** — a match inside a collapsed tool block (e.g. AskUserQuestion) now auto-expands and highlights the matched text, and navigating between occurrences scrolls straight to the match instead of double-scrolling through the message. (#481, #429)
- **Cursor Agent CLI transcript rendering** — strip the `<user_query>`/`<context>` XML envelope from prompts, hide fully-`[REDACTED]` messages (keeping partially-redacted ones), and surface `tool_result` / `command_output` (shell) output that was previously missing. (#482, closes #472)
- **Session rename under symlinked project dirs** — renaming works for sessions in depth-1 symlinked project directories and registered custom Claude directories, with a hardened path validator. (#478)
- **Renames reflected in `claude -r`** — a custom-title event is written so Claude Code 2.x shows renamed sessions on resume. (#477)
- **VS Code legacy sessions** — read legacy `.json` chat sessions and multi-root workspaces. (#469)
- **Folder selector layout** — a long path no longer distorts the folder-select dialog width. (#479)

## [1.21.0] - 2026-07-12

Performance release: a full data-scaling pass for large histories — paginated message loading, cached analytics, and self-validating search caches — plus session multi-select with mass delete.

### Added
- **Session multi-select with mass delete** — Finder-style selection (Shift range, Cmd/Ctrl toggle) with a selection bar for copying session IDs and deleting in bulk; providers that don't support deletion are skipped with a notice. (#456)
- **"Load & select all" for paginated session lists** — select-all now shows exactly how many loaded sessions it covers, warns when more sessions exist on disk than are loaded, and can page in the rest before selecting. (#459)
- **Vibe image attachments** render in session transcripts.
- **Codex zstd-compressed rollouts** (`.jsonl.zst`) are discovered and parsed.

### Performance
- **Messages load in pages** — opening a session fetches the newest ~200 messages instead of the whole transcript (a 47k-message session no longer stalls the app). Scrolling up loads earlier pages with a stable viewport; deep links and search jumps extend the window automatically; export and in-session search still cover the complete conversation. (#458)
- **Project session lists load in pages** with an explicit "load more" control. (#381)
- **Analytics statistics are cached per file** — the global/project dashboards re-parse only files that actually changed instead of the entire corpus on every open and date-filter change, with byte-identical results. (#464)
- **Search results stay cached while sessions are being written** — the search cache validates each file's size/mtime at serve time instead of evicting everything on any file change; filter and limit changes reuse cached matches with zero re-scans. (#467)
- **Global-search result clicks resolve directly** — the clicked result's project is tried first (one request in the common case) and any fallback sweep runs in parallel batches with cancellation, replacing the serial all-projects scan. (#466)
- **The project sidebar stays responsive with large project counts** — search filtering is deferred off the keystroke path and collapsed rows skip offscreen rendering. (#460)
- **Huge tool outputs no longer freeze the viewer** — syntax highlighting is skipped above 50k characters and very large text/JSON blocks render a preview with an explicit "show all". (#461)
- **VS Code-family workspace scans run in parallel** (Cursor, VS Code, Trae, Cline, Crush) on a bounded pool, so locked workspace databases no longer stack 5-second waits serially at startup. (#468)

### Fixed
- **WebUI `--serve` mode**: `detect_claude_config_dir` was missing from the server router — `CLAUDE_CONFIG_DIR` auto-detection silently failed and every session logged a 405 console error. (#465)
- The multi-select session checkbox is keyboard-operable (a11y).
- Codex rollouts without a `session_meta` are identified via `turn_context` cwd and filename id.

## [1.20.0] - 2026-07-12

Feature release: Mistral Vibe provider support (now 28 supported assistants) plus analytics and live-refresh fixes.

### Added
- **Mistral Vibe provider support** — sessions from `~/.vibe/logs/session/` (`meta.json` + `messages.jsonl`, OpenAI-style transcripts with reasoning and tool calls), honoring `$VIBE_HOME`. Implementation verified against the upstream `mistralai/mistral-vibe` source during review. (#438, closes #427)

### Changed
- **Analytics model pricing updated** for the latest Anthropic (Fable 5, Opus 4.8, Sonnet 5) and OpenAI (GPT-5.6 family) models; OpenAI entries keep zero cache-write cost per provider billing. (#457)
- Translated READMEs list all 28 providers (they were missing the Pi/oh-my-pi rows added in 1.19.0).

### Fixed
- **Pi and oh-my-pi sessions live-refresh again** — file-change events under `~/.pi/agent/sessions` and `~/.omp/agent/sessions` were watched but never mapped to a project/session, so the UI ignored them.

## [1.19.0] - 2026-07-12

Feature release: two new providers (now 27 supported assistants), Claude Code Workflow rendering, and a cross-provider parallel-task filter.

### Added
- **Pi and oh-my-pi provider support** — sessions from `~/.pi/agent/sessions` and `~/.omp/agent/sessions`, parsed by one shared store-parameterized core. (#445, closes #359, #279)
- **Claude Code Workflow rendering** — `Workflow` tool calls now render a dedicated card (workflow name, status, run id, collapsible script and result) with the run's agent transcripts listed and navigable in the center panel; workflow sub-agents also appear in the SubAgent panel. (#449)
- **Parallel Tasks filter** — provider-neutral classification of multi-agent history (Claude task groups, Codex `spawn_agent` collaboration, Gemini CLI / Qwen Code agents, OpenCode) with a filter-toolbar toggle and a right-side navigator control. (#446)
- **Global conversation refresh** button in the header — rescans all projects, reloads the current selection when still present, and clears stale selections. (#439)

### Fixed
- **Project tree session counts match the opened session list** — `scan_projects` counts only top-level session files, excluding sidechain/subagent transcripts nested under the session directory. (#450)
- **Forked Codex sessions (`codex fork`) now list under the right project** — the first `session_meta` identifies the file; the source session's replayed meta no longer misfiles the session or re-tags its messages. (#451)
- **Font-size setting now applies to AI tool/thinking boxes and assistant markdown** — the `!important` prose override and hardcoded code-block sizes are scale-aware. (#440, #441, #443)
- **In-session search matches tool arguments** — `tool_use.input` is now indexed. (#437)
- **Vite dev server no longer crashes on Windows** trying to watch locked binaries under `src-tauri/target/`. (#442)

### Changed
- Translated READMEs (한국어, 日本語, 简体中文, 繁體中文) synced to the current English README after five stale releases.

## [1.18.0] - 2026-06-30

Feature and fix release: search/sidebar usability improvements plus a significant startup-performance fix.

### Added
- **Global search results now show which conversation each match belongs to**, so you can tell apart matches that share the same text across sessions. (#426)
- **Collapsible provider-filter panel in the sidebar**, reclaiming vertical space for the session list on narrow sidebars; the collapsed header still surfaces the active filter summary and count. (#431)

### Changed
- **Project identity prefers the verifiable on-disk folder name over a stale `cwd`** embedded in old transcripts, so projects that moved or were recorded by a subagent group correctly. Existing projects may show a corrected display name after the first scan. (#419)

### Performance
- **Startup no longer stalls for tens of seconds.** Provider scanners now run concurrently instead of sequentially, so a locked SQLite database (from a tool running alongside the viewer) no longer stacks its timeout against the others — the worst case drops from a sum of timeouts to a single overlapped wait. (#436, #434)

### Fixed
- **Exporting a subagent session now includes its messages** instead of producing an empty file. The sidechain filter is only applied to parent-session exports now. (#435, #433)
- **OpenCode global sessions are split by directory** into separate virtual projects, and sessions with an empty `directory` value now load correctly (scan and load hash the same raw value). (#432)
- **OpenCode session cache is bounded** (LRU, 10k entries) to prevent unbounded memory growth from the file watcher. (#428)
- **Cline-family truncation is char-safe** and Roo/Kilo summary labels render correctly. (#425)

## [1.17.1] - 2026-06-23

Patch release fixing conversation loading for several assistants added in 1.17.0.

### Fixed
- **Kilo Code conversations now load.** The task index is read from VS Code's `globalState` (the global `state.vscdb`, keyed by extension id) where Kilo actually stores it — previously only the on-disk index files (`state/taskHistory.json` / `tasks/_index.json`) that Kilo never writes were checked, so Kilo always showed zero sessions. (#422)
- **Roo Code projects now group by workspace.** Roo (and Kilo) name the working-directory field `workspace`, not Cline's `cwdOnTaskInitialization`, so every conversation previously collapsed into a single "unknown" project. (#422)
- **Zed tool results render as readable text** instead of raw tagged JSON. Zed stores a tool result's content as `Vec<LanguageModelToolResultContent>` (e.g. `[{"Text":"…"}]`); it is now unwrapped to its text (images become an `[image]` placeholder) rather than shown verbatim. (#423)
- **Zed is now detected on Linux and Windows.** The threads database is read from Zed's real per-OS location — lowercase `~/.local/share/zed` on Linux and `%LOCALAPPDATA%\Zed` on Windows (it was looking under `Zed` / `%APPDATA%`). macOS was already correct. (#424)
- **Zed no longer errors on older thread databases.** Project/session queries adapt to the columns actually present (`folder_paths` / `created_at` are absent on older schemas), so threads from older Zed versions load instead of failing the whole provider. (#424)

## [1.17.0] - 2026-06-22

### Added
- **Eleven new read-only providers**, expanding coverage from 14 to ~25 AI coding assistants:
  - **Continue.dev** (`~/.continue/sessions/*.json`, grouped by `workspaceDirectory`; honors `CONTINUE_GLOBAL_DIR`) and its fork **PearAI** (`~/.pearai/sessions`), sharing a parameterized Continue-family core. (#416)
  - **Kilo Code** — folded into the Cline-family reader (`kilocode.kilo-code` globalStorage; per-task files byte-identical to Cline/Roo). (#416)
  - **Goose** (`<data-dir>/goose/sessions/sessions.db`, SQLite), **Crush** (per-project `./.crush/crush.db`, discovered by scanning common code roots), and **llm** (Simon Willison's `io.datasette.llm/logs.db`, with token counts). (#416)
  - **Amazon Q Developer CLI** (`amazon-q/data.sqlite3` `conversations`), sharing `ConversationState` parsing with the Kiro CLI provider. (#417)
  - **Open Interpreter** (`~/.openinterpreter/sessions/**` — Codex-format rollouts, reusing the Codex parser; `INTERPRETER_HOME` override). (#418)
  - **Qwen Code** (`~/.qwen/projects/<cwd>/chats/*.jsonl`). (#418)
  - **Zed** (Agent Panel threads in `…/Zed/threads/threads.db` — SQLite + Zstd-compressed JSON). (#418)
  - **OpenHands** (classic `~/.openhands/sessions/<id>/events/*.json`). (#418)
  - **Trae** (per-workspace `state.vscdb` icube chat — reverse-engineered, provisional). (#418)

### Fixed
- Kiro CLI database path on Windows now resolves via `data_local_dir()` (`%LOCALAPPDATA%`) instead of the incorrect `AppData\Roaming`. (#417)

## [1.16.0] - 2026-06-21

### Added
- **GitHub Copilot providers** — read-only browsing of GitHub Copilot CLI (`~/.copilot/session-state/<id>/events.jsonl`, tool calls paired via `toolCallId`, resume via `copilot --resume=<id>`), Copilot Desktop (same on-disk format, differentiated via `workspace.yaml::client_name`), and VS Code Copilot Chat (`workspaceStorage/.../chatSessions/*.jsonl` replayed as a `kind:0` snapshot + `kind:1`/`kind:2` patch log; detects Code/Insiders/VSCodium). All three participate in WSL scanning and global search. (#415, rebase of #350)
- **Headless session export** — new `--export <session-id|/abs/path.jsonl> [--format html|json] [--output <file>]` flag renders a report and exits without launching the GUI, for SSH/CI use. HTML output is a Rust port of the in-app exporter (markdown via `comrak`); session ids resolve under `~/.claude/projects` (unambiguous prefix accepted) and the file is written atomically. (#413)
- **Most Used Skills / Most Used Subagents analytics** — tool-usage stats now break Claude `Skill` and `Agent` calls out into dedicated sections keyed by `input.skill` / `input.subagent_type`, at both project and global scope; sections are hidden when empty so non-Claude providers are unaffected. (#414)
- **One-click Full Backup** — an Archive Manager "Full Backup" card copies every session from all Claude Code projects into per-project archives in a single action (with an "Include subagent transcripts" toggle), so history survives Claude Code's automatic cleanup. (#411)

### Fixed
- The font-size setting now applies to the whole app, not just the left panel: ~256 hardcoded `text-[Npx]` classes (and the `prose-xs` markdown variant) were made reactive to the setting, so the message viewer, analytics, session board, and settings dialogs scale together. Pixel-exact at the default scale. (#412)
- Session delete now falls back to a permanent delete when the system trash is unavailable (Windows Recycle Bin disabled, network drives, locked files) instead of surfacing an opaque failure; the delete-confirmation copy reflects this across all 5 locales. (#410)
- Codex session delete removes the orphaned `threads` row left in `state_5.sqlite` by a prior native rename — best-effort, never blocking the delete. (#409)

### New Contributors
- @theontho (#350 → #415)

## [1.15.0] - 2026-06-21

### Added
- **Three new read-only providers**: **Cursor Agent** (`~/.cursor/projects/.../agent-transcripts`, distinct from the Cursor IDE source) (#304, #397), **Kimi CLI** (`~/.kimi` sessions, `kimi -r` resume) (#349), and **Kiro CLI** (SQLite-backed `kiro-cli/data.sqlite3`) (#324).
- **Codex native rename & delete**: rename writes `threads.title` in `state_5.sqlite` (the resume-picker-visible name) while the rollout transcript stays immutable; honors `CODEX_HOME` for both `sessions` and `archived_sessions`; a new in-app delete confirmation dialog replaces the OS-native prompt. (#373)

### Changed
- Codex project-list scans now mmap + memchr-scan only the `session_meta` line instead of fully parsing every rollout, and each provider scans independently so a slow provider no longer blocks fast ones from appearing. (#370)
- In-session search indexing moved to a Web Worker (FlexSearch) so indexing a large session no longer blocks the UI. (#352)
- Claude project name and the `claude --resume` working directory are now resolved from session JSONL metadata instead of the lossy storage-dir encoding. `CACHE_VERSION` bumped to 10 (one-time transparent re-scan on first launch). (#369)

### Fixed
- Removed blank gaps in the virtualized message history and stopped the first rows rendering under the sticky header, while preserving the subagent-crash (#334) and sidechain (#389) handling. (#371)
- Kimi watcher auto-refresh on macOS: canonicalize the event path before base-path matching (`/var` → `/private/var` symlink). (#407)
- Cursor scan no longer panics on multibyte/percent workspace-folder names. (#398)
- Claude native rename uses the correct event format and preserves the first user prompt on title reset. (#368)
- Improved long project-path labels in the project tree. (#354)

### Internal
- Added a frontend CI gate (tsc / eslint / vitest / i18n) on pull requests. (#406)

## [1.14.1] - 2026-06-20

### Fixed
- Global search now matches tool-result content, not just message text. (#394)
- Recognize the `/branch` custom title as a session-rename source. (#395)
- Detect and parse Gemini CLI `.jsonl` sessions. (#348)
- Show the conversation when navigating from a global-search hit. (#390)
- Project-list scrollbar now reaches the bottom (`min-h-0`). (#101)

## [1.14.0] - 2026-06-17

### Added
- **CodeBuddy Code provider** — browse CodeBuddy conversation history alongside the other assistants. (#353)
- **WebUI account login** for `--serve` mode: optional Argon2id account auth + server-side sessions + CSRF, a read-only mode, and base-path support for reverse-proxy hosting. (#384)
- Render advisor tool results instead of the unknown-type fallback. (#380, #386)

### Changed
- Role and content-type message filters now persist across session switches and app restarts. (#363)

### Fixed
- Estimate full height for subagent rows to prevent the React #185 crash when opening large subagent sessions. (#334)
- Map subagent clicks via `meta.json` `toolUseId` for multi-subagent sessions. (#288)
- Include custom Claude directories in the global stats summary. (#362)
- Accept sessions under a symlinked `~/.claude` allowlist root. (#355)
- Configure ibus/fcitx IME env on Linux startup so CJK input works in the search box. (#360)
- Stop a WebUI watcher refresh loop. (#367)
- WSL chat history no longer ignored in project list / global search for Claude-only users. (#347)
- Use the OverlayScrollbars `initialized` event instead of polling. (#351)

## [1.13.0] - 2026-05-25

### Added
- **macOS Custom Overlay Title Bar**: Draggable header with `data-tauri-drag-region`; eliminates the legacy macOS title bar so the app uses screen space more consistently. Linux/Windows behavior unchanged. (#337)
- **Session Source Filter**: Reads the top-level `entrypoint` field (`cli`, `claude-vscode`, `claude-desktop`) in Claude Code JSONL records and exposes a filter to separate sessions by where they were created. Cache version bumped to invalidate stale snapshots. (#330)
- **Codex Resume Command**: Right-click "Copy Resume Command" now supports Codex sessions and prefixes the copied command with `cd '<cwd>' && ` so paste-and-run lands in the session's original directory. SessionId is regex-validated before shell interpolation. (#302)

### Changed
- Sidebar resizable panel `maxWidth` raised from 480 → 800 to fit long project names; deep-path slug parsing delegates to the existing filesystem-check decoder. (#329)
- macOS updater falls back to a native OS-level relaunch (`open -n`) when Tauri v2's `relaunch()` throws on macOS; Windows uses PowerShell `Wait-Process` + `Start-Process` (avoids `cmd /C "start"` `%` corruption); Linux uses `setsid`. All paths use parent-PID polling instead of fixed sleeps. (#325, closes #287)

### Fixed
- **Pricing accuracy**:
  - `claude-opus-4-7` was billed at deprecated Opus 4 rates ($15/$75) via `includes()` match-order — added explicit entry at correct rates ($5/$25/$6.25/$0.50). Prevents 3× overcharge. (#335)
  - Added `gpt-5.4`/`gpt-5.5` pricing rows and refactored Codex token extraction to return `(input, output, cached)` so `non_cached_input = delta_input − delta_cached` splits the two billing tiers correctly. (#336)
- WSL settings no longer crash when partial settings omit `excludedDistros`; defaults-first spread keeps the toggle working. (#309)
- Session delete failures now surface the backend error in the toast description with the session id, so reporters can diagnose. (#310)
- WebUI mode: `get_session_subagents` registered on the Axum router; closes a Tauri↔Axum parity gap (#294). (#311)
- ForgeCode: stricter virtual-path allowlist, env-guarded `FORGE_CONFIG` tests, archive/rename dialog polish. (#312)
- Antigravity stats correctness: 7 follow-ups across stats aggregation, symlink guards on rpc-cache reads, filesystem-only brain session inclusion, refusing to guess root when marker absent, date-filtered tool usage, rpc-cache fallback for usage records, canonicalised `session_path` validation. (#313, #314, #315, #316, #317, #318, #320)
- Codex session summary picker now skips the auto-injected `<environment_context>` so the displayed summary reflects the actual first user message. (#322)
- Global stats aggregate `token_distribution.reasoning` correctly across providers. (#323)

### Internal
- Tauri 2.10.1 → 2.11.2 (+ plugin patches); JS/Rust version alignment preserved.
- `tauriConfig.test.ts` realigned for the new "empty window[0].title, productName as CFBundleName" design.
- Codex `and_then(|v| v.as_u64())` → `and_then(Value::as_u64)` for Rust 1.95 `clippy::redundant-closure-for-method-calls`.

### New Contributors
- @ypoet (#302)
- @xxmy7 (#335, #336)
- @SoraDaibu (#325)
- @ggvswild (#330)
- @mohammedi-haroune (#337)

## [1.12.0] - 2026-05-07

### Added
- **Antigravity Provider**: Sessions loaded through the standard provider pipeline with full project/session views, token stats, analytics, and global search — no separate UI mode (#291)
- **ForgeCode Provider**: SQLite-backed reader for `~/.forge/.forge.db` with multi-provider plumbing for scan, sessions, messages, search, stats, and archive (#295)
- **External Session Launching**: New `--session <uuid-or-prefix>` CLI flag (#261), with single-instance enforcement plus macOS Apple Events for re-invocation (#274), Stage B prefix resolvers and a session picker modal for ambiguous input (#270, #272)
- **Show Sub-agent Messages Toggle**: Header settings dropdown now exposes the existing `excludeSidechain` filter so users can collapse sub-agent clutter without DevTools (#299, addresses #282)
- **Symlink Following at Depth 1**: `scan_projects` follows directory symlinks one level deep with deduplication and tests (#277, #281)

### Changed
- Render context menus in a portal so they anchor precisely to the cursor (#268)
- Clamp context menus to panel bounds and close on outside scroll (#278)
- Apply custom Claude directory selection instantly without restart (#255)
- Bump session list fixed row height to fit 2-line wrapped names (#298)
- Multi-pass scroll to correct TOC click landing position (#303)
- Unified argv parser shared between desktop and `cchv-server` (#271)

### Fixed
- Resolve infinite loading and rendering issues for sub-agent sessions (#258, #264)
- Fall back to estimated cost when `costUSD` is absent in message metadata (#301)
- Boot correctly for setups without `~/.claude` (other-provider-only configurations) (#300)
- Bound graceful shutdown so `cchv-server` exits on Ctrl+C (#297)
- Preserve bubble timestamps in search results (#273)
- Dedupe token usage across split assistant turn rows (#283, #289)

### Internal
- Align `@tauri-apps/api`, `plugin-dialog`, `plugin-updater` JS packages with their Rust crates (`tauri-action` enforces version match)
- Replace `sort_by` + `Reverse` comparator with idiomatic `sort_by_key` (#275)

### New Contributors
- @BenCello (#277)
- @djdarcy (#261)
- @greenbritainclub-ux (#268)
- @isimple4 (#273)

## [1.11.0] - 2026-04-12

### Added
- **Auto-refresh Sessions**: Session list auto-refreshes when underlying files change; auto-scroll to bottom on new messages (#242)
- **Project Panel Search & Horizontal Scrollbar**: Search box plus horizontal scrollbar for long project names (#248)
- **Session Right-click Context Menu**: Copy session ID, resume command, file path; delete session; show JSONL file; native rename with search integration (#251)
- **Sub-agent Conversation History**: View sub-agent (sidechain) conversation history (#252)
- **Custom Claude Config Directories**: Support directories outside `~/.claude` for users with non-default configurations (#254)

### Fixed
- WSL scan toggle not working (#247)
- Docker proxy support and missing runtime libraries for `webui-server` mode (#243)

### New Contributors
- @freekingxx (#243)

## [1.10.0] - 2026-04-10

### Added
- **Monthly Calendar Heatmap**: Activity heatmap split into monthly calendar blocks for clearer visualization (#231)
- **Delete Session**: Move sessions to trash from context menu (#229)
- **Show JSONL File**: Open JSONL file in system file explorer from session context menu (#228)
- **Copy Path**: Copy project path from project context menu (#224)
- **Date Filter for Global Stats**: DatePickerHeader added to GlobalStatsView for date range filtering (#225)
- **Windows Portable Build**: Portable `.zip` distribution added to release artifacts alongside `.exe` installer (#232)
- **OpenCode Step Renderer**: Render OpenCode step-finish events as meaningful step cards (#223)
- **Per-tool Unified Cards**: Split UnifiedToolExecutionRenderer into dedicated cards (Bash, Read, Edit, Glob, Grep, Write, WebFetch, WebSearch, Agent)

### Fixed
- Session ID, resume command, and file path copy failures (#244)
- Codex messages shown twice due to missing deduplication (#227)
- Windows absolute path validation in revealInFinder (#230)
- Docker runtime and remote build issues (libgtk-3-0, corepack, MSRV) (#230)

## [1.6.0] - 2026-03-08

### Added
- **WebUI Server Mode**: Run as a standalone web server with `--serve` flag for remote/headless access
  - Bearer token authentication for secure access
  - SSE real-time file watcher for live session updates
  - Single-binary deployment with embedded frontend via rust-embed
  - Docker and docker-compose support
  - Homebrew formula (`cchv-server`) with auto-update CI
  - Comprehensive server guides (EN + KO)
- **Screenshot Capture**: Long screenshot with range selection, preview modal, and explorer-style multi-selection
- **Archive Management**: Create, browse, rename, delete, and export session archives
  - Name-based archive IDs (e.g., `My-Project_3f8a1b2c`) replacing UUID-only format
  - Per-session and per-subagent inline export buttons
  - Automatic legacy UUID directory migration
- **Accessibility**: Keyboard navigation, screen reader support, and readability improvements across the app
- **Mobile UI**: Comprehensive 390px viewport support with bottom tab bar and responsive layouts
- **External Links**: All links now open in the system default browser instead of WebView (#165)
- **Platform Detection**: `PlatformCapabilities` context for centralized Tauri/WebUI runtime detection

### Changed
- Split `App.tsx` into modular architecture (`AppLayout`, `useAppInitialization`, `useAppKeyboard`)
- Extract shared `Markdown` component with unified remark/rehype config
- Decompose `SessionItem` into sub-components (`SessionHeader`, `SessionMeta`, `SessionNameEditor`)
- Split `useAnalytics` hook into focused modules (`useAnalyticsAutoLoad`, `useAnalyticsComputed`, `useAnalyticsNavigation`)
- Split Vite bundle chunks to eliminate 1.28MB index warning
- Remove markdown export format from archive, keep JSON only

### Fixed
- Multi-byte string panic when slicing token preview in Rust backend
- Focus ring outlines removed from all UI components
- ANSI text rendering applied to all terminal output paths
- Consistent markdown rendering across all content renderers
- Updater UX improved with manual restart fallback state
- Capture font readiness wait with proper timeout
- Mobile renderer layout overflow and navigation dedup for 390px viewport
- 43 security review findings addressed for WebUI server mode
- SHA256 checksum verification added to install script

### Security
- WebUI server mode includes Bearer token authentication
- `rehypeSanitize` added to markdown rendering pipeline
- Archive ID validation hardened against path traversal

## [1.5.3] - 2026-02-22

### Added
- Deep linking from Token Stats view to detailed session conversation
- Brushing UI refinement with single-select brushing and translucent pixel view

### Changed
- Comprehensive type safety improvements with proper type guards for `ClaudeMessage` union type
- Extracted `toolIconUtils.ts` and refactored `toolSummaries.ts` for reduced complexity
- Memoized tool frequency calculations to prevent unnecessary re-renders

### Fixed
- React "Rule of Hooks" violation in `App.tsx`
- Production build failures caused by missing Aptabase environment variables
- Infinite loading when switching sessions from Board view via optimistic store updates

## [1.5.2] - 2026-02-21

### Added

- Update Notes in Modal: Auto-update modal now shows release name and release notes from updater metadata.
- One-click Issue Report from Update Failure: Failure state now opens the feedback modal with updater diagnostics prefilled for faster bug reporting.

### Changed

- Updater Stage UX: Download, install, and restart stages are separated and reflected in UI states for clearer progress feedback.

### Fixed

- Updater Error Mapping: Distinguishes install-stage and restart-stage failures to avoid misleading `Download failed` messages after successful payload download.
- Release Workflow Auth: Split GitHub token usage between main repository and tap repository access in updater release workflow.

## [1.0.0-beta.4] - 2025-12-21

### Added

- Global Aggregated Dashboard: View aggregated statistics across all projects in a single dashboard
- Accurate Session Time Calculation: Session duration now calculated precisely from message timestamps
- Accurate Pricing Information: Token usage cost calculation with accurate pricing model
- Linux Build Support: Added comprehensive Linux build support with cross-platform automation
- Unit Tests: Added Vitest unit tests for tauri.conf.json validation and importability
- Update Check Caching: Added update check result caching utility and force update check feature

### Changed

- Default Language: Changed default language from Korean to English for better international accessibility
- Search Performance: Optimized search performance for large JSONL files with improved indexing
- JSONL Loading Optimization: Analyzed and optimized batch size for better loading performance
- Build System: Enhanced build system with multi-package-manager support

### Fixed

- Complete i18n Coverage: Removed all hardcoded Korean text that was ignoring language settings
- Auto Language Detection: App automatically detects and displays in user's system language on first launch
- Security Patches: Applied critical security patches and code quality improvements

## [1.0.0-beta.3] - 2025-07-03

### Added
- Multi-language support: 5 languages (Korean, English, Japanese, Simplified/Traditional Chinese)
- Feedback system: Category-based feedback submission with GitHub integration
- Language selection menu: Real-time language switching in settings

### Changed
- File reading performance improvements with file size estimation
- Library consolidation: Unified syntax highlighting library
- README simplified: 46% reduction focused on core features

## [1.0.0-beta.2] - 2025-07-02

### Added
- Analytics Dashboard: Usage patterns, token usage, activity heatmap
- Auto-update system: Priority-based update notifications
- Thinking content display: Formatted Claude thinking process

### Changed
- Pagination: Fast initial loading with 100-message batches
- HeadlessUI replaced with Radix UI
- Lucide React icon library adopted

## [1.0.0-beta.1] - 2025-06-30

### Added
- Project/session browser: Hierarchical tree structure for Claude Code conversations
- Full-text search across all conversation history
- Syntax highlighting for all programming languages
- Token usage statistics: Per-project, per-session analysis and visualization
- Dark mode support: Dark, light, and system mode
- Virtual scrolling for large message lists
- Image rendering support
- Diff viewer for file changes
