# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
