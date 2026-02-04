# Refactoring Roadmap (Feb 2026)

Comprehensive analysis of 5 areas identified ~90 refactoring points.

## CRITICAL (Fix immediately) — 8 items

### Rust Backend
1. **stats.rs:440-528** — `get_session_token_stats` and `extract_session_token_stats_sync` share 90% identical code. Extract `extract_token_stats_from_messages()` helper.
2. **session/load.rs:190-458** — `extract_session_metadata_internal` is 268 lines. Split into `parse_metadata_phase()`, `parse_counting_phase()`, `calculate_session_duration()`.
3. **session/load.rs:578-798** — `load_project_sessions` is 220 lines mixing caching, parsing, sorting. Split into `categorize_file_strategies()`, `process_file_strategies()`, `apply_sidechain_filter()`.

### Frontend Hooks
4. **useAnalytics.ts** — 617-line single hook with 24-dependency useEffect. Split into useTokenStatsView, useAnalyticsView, useRecentEditsView, useBoardView.

### Frontend Utils
5. **formatters.ts + time.ts** — Duplicate `formatDuration` implementations. Consolidate to single source in time.ts.
6. **searchIndex.ts:20-179** — `extractSearchableText` 160 lines with deep nesting. Extract per-content-type extractors.

### Store
7. **messageSlice.ts:384** — `window.alert` in data layer. Remove, use error state instead.
8. **settingsSlice.ts:62-78** — Setters call `selectProject()` as side effect. Remove, let UI handle refresh.

## HIGH (Fix before merge) — 12 items

### App.tsx Architecture
1. **App.tsx:30-67** — 67 properties destructured from store → re-renders on any change. Create specialized selectors.
2. **App.tsx:318-451** — 130-line nested ternary view routing. Extract `<ContentRouter />` component.
3. **App.tsx:121-245** — Navigation handler duplication. Extract `useNavigationHandlers()` hook.

### Components
4. **ProjectTree.tsx** — 15 props drilling. Create ProjectTreeContext.
5. **SettingsEditorPane.tsx (454 lines)** — Mixed JSON editing + visual editing + save logic. Split into 3 components.
6. **EnhancedDiffViewer.tsx:80-167** — 88-line inline `highlightSyntax`. Extract to utils/syntaxHighlighting.ts.

### Hooks
7. **usePresets/useMCPPresets/useUnifiedPresets** — 90%+ identical CRUD code x3. Create generic `usePresetManager<T>`.
8. **useResizablePanel.ts** — localStorage access without try/catch (violates PR #78 checklist).

### Utils
9. **settingsMerger.ts (470 lines)** — Mixed types, helpers, merge logic. Split into 3 files.

### Rust
10. **8 functions with identical mmap boilerplate** — Extract `open_session_file_mmap()` helper.
11. **stats.rs:752-955** — `get_project_stats_summary` 203 lines. Split into collect/aggregate/finalize/build.
12. **messageSlice.ts (397 lines)** — 3 responsibilities: session selection, token stats, analytics. Split into sub-slices.

## MEDIUM — ~30 items (key patterns)

### Rust
- Token extraction logic duplicated in 3+ functions
- Session duration calculation duplicated (120-min break threshold)
- Error handling returns generic `String` instead of structured enum
- Line parsing boilerplate (find_line_ranges + par_iter + simd_json) in 6 functions

### Store
- Date normalization `setHours(23,59,59,999)` duplicated 4 times → extract to utils/time.ts
- Error handling pattern inconsistent across 26 try/catch blocks → create `handleStoreError()` utility
- analyticsSlice has 10 nearly identical setter functions → use generic `setAnalyticsField()`
- boardSlice stores derived `visibleSessionIds` → compute on-demand

### Components
- 29 files with inline `style={{}}` → extract to constants or Tailwind
- Scope color constants duplicated (MCPServersSection + UnifiedMCPDialog)
- `getLanguageFromPath` duplicated (EnhancedDiffViewer + renderers/utils)
- `formatTimeAgo` inline in ProjectTree → move to utils/time.ts

### Hooks
- `useMCPServers` loads from 5 sources with complex state → extract per-source loader
- `useSessionMetadata` has 7 nearly identical callbacks → create generic updater
- `useCopyButton` mixes UI rendering with hook logic → split into hook + component

### Utils
- Windows path detection incomplete (only C:\Users\, missing D:\, UNC)
- messageUtils image detection functions overlap
- `toolUtils.getToolName` uses fragile structural inference

## Recommended Refactoring Order

1. **useAnalytics.ts split** — biggest complexity reduction
2. **App.tsx ContentRouter extraction** — 130 lines removed
3. **Rust stats.rs dedup** — token extraction/session stats common functions
4. **Preset hooks consolidation** — 3 files → 1 generic
5. **Store error handling standardization** — 26 try/catch patterns unified
6. **Rust mmap/parsing utilities** — 8 functions boilerplate eliminated
