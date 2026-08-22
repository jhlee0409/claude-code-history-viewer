# Recent Edits: dockable panel, compact density, session scope

> Status: design approved, ready to implement
> Date: 2026-08-21
> Scope: Recent Edits view only. Introduces a minimal panel dock that later panels can register into.
> Visual reference: [`docs/design/recent-edits-panel-design.md`](../design/recent-edits-panel-design.md)

## Background

`Recent Edits` is currently a value of the mutually exclusive `analytics.currentView` enum
(`messages | analytics | tokenStats | recentEdits | board | settings | archive`). By construction
that makes it a *sibling* of the message viewer, so it always takes the entire content area and
can never be shown beside a transcript. There is also no compact density and no way to scope the
list to a single session.

Three gaps:

1. Every row is a ~72px card, so roughly 8 files fit on screen out of 325.
2. The view cannot be docked next to the conversation it describes.
3. The list is always project-wide, even when one session is selected.

## Goals

1. Recent Edits can be docked as a resizable right panel beside the transcript.
2. A compact row density, defaulting to compact when docked and standard on the full page.
3. A scope toggle: whole project, or the selected session only.
4. A grouping toggle: one row per file (latest state), or one row per edit event (chronological).
5. Panel mode, density, scope, grouping and width persist across project changes, session changes
   and reload.

## Non-goals (YAGNI)

- Fixing the search box, which today filters only the loaded page rather than the whole result
  set. Real bug, separate effort.
- Splitting edit metadata from edit content in the payload. Belongs with the search fix.
- Migrating `MessageNavigator` into the new dock. It stays a standalone rail for now.
- A file tree panel. Explored separately; this spec only leaves the door open for it.
- Per-field show/hide customization of the compact row. Density presets plus an overflow menu
  cover the need.
- Roving-tabindex arrow navigation over rows. Rows are native buttons and remain keyboard
  operable.

## Verified constraints (code-read 2026-08-21)

- `RecentFileEdit` already carries `session_id`, populated per JSONL line from
  `log_entry.session_id` (`src-tauri/src/commands/session/edits.rs:69`). Session filtering is
  possible with existing metadata.
- `actual_session_id` is only the **first** session id found in a file
  (`commands/session/load.rs:424-426`), so filtering by id would drop edits from a resumed session
  whose id changes mid-file. Scanning by **file path** avoids this and is also much faster: one
  mmap instead of a `WalkDir` over every session in the project.
- `FileEditItemProps` is `{ edit: RecentFileEdit, isDarkMode }`. The component renders **one edit
  record** and is already event-shaped, so per-edit grouping needs no component change.
- `original_content` and `content_after_change` are per record
  (`src/components/RecentEditsViewer/FileEditItem.tsx:400-401`), so a chronological row's diff is
  already correct.
- The React key is already `` `${edit.file_path}-${index}` ``
  (`RecentEditsViewer.tsx:159`), a composite that tolerates repeated paths.
- `paginate_recent_edits` (`edits.rs:456`) filters to `project_cwd`, sorts descending, dedups into
  `latest_by_file`, then `skip(offset).take(limit)`. Only the dedup step is conditional.
- Dock primitives already exist and are proven by `MessageNavigator`:
  `useResizablePanel({ storageKey, direction: "left" })` (`src/App.tsx:330`), `navigatorSlice.ts`
  for a persisted boolean, `@tanstack/react-virtual`, and the `asideId` plus skip-link pattern in
  `AppLayout.tsx`.
- The house segmented-control style is `src/components/ui/MetricModeToggle.tsx`: track
  `bg-muted/30 rounded-lg p-1 gap-1`, active `bg-card text-foreground shadow-sm`, inactive
  `text-muted-foreground hover:text-foreground`, `aria-pressed` per button, labels via
  `t(key, fallback)`. Reuse it rather than introducing a new style.
- `DropdownMenuRadioGroup` / `DropdownMenuRadioItem` already exist in
  `src/components/ui/dropdown-menu.tsx`.
- `SettingsManager` covers MCP, presets and paths, and has no appearance or display section, so a
  view-mode radio does not belong there.
- Axum parity call sites: `RecentEditsParams` handler at `src-tauri/src/server/handlers.rs:556`,
  route at `server/mod.rs:223`, read-only allowlist entry at `server/mod.rs:71`.
- `restore_file` already has path-traversal and null-byte tests (`edits.rs:262-283`) to model the
  new `session_file_path` validation on.

## Prerequisite (separate PR, lands first)

**Suspected always-miss on the recent-edits cache.** `useAnalyticsNavigation.ts` guards the fetch
with `analytics.recentEdits.project_cwd === project.path`. `project.path` is the encoded Claude
storage path (`~/.claude/projects/-E--Projects-...`, per the doc comment at
`src/types/session.types.ts:41`); `project_cwd` is the most frequent filesystem `cwd` observed in
the logs (`edits.rs:609`). Those should never be equal, which would mean every visit re-walks and
re-parses every JSONL in the project. `project.actual_path` looks like the intended comparand.

This is inferred from reading, **not** from running. Step 0 is to log both values at runtime,
confirm, and only then change it. A docked panel is opened far more often than a full-page view,
so this wants settling first.

## Design (approved over three review rounds)

### Row

Two lines, roughly 46px.

- **Line 1**: chevron, colored dot, filename, then counts and relative time, right aligned.
- **Line 2**: elided directory path alone, with hover-revealed action buttons on its right.

```
> . HISTORY.md                                        +25 -6   14h
    skills/deliver-prd/                                    [reveal] [...]
```

- **Chevron and dot align to line 1**, not to the vertical centre of the row. In CSS this is
  `align-items: flex-start` on the row header plus `margin-top: 3.5px` on the 12px chevron and
  `6px` on the 7px dot, centring each glyph against the filename's 19px line box.
  **This looks like a mistake to anyone tidying the CSS, so it needs a comment.** Plain
  `flex-start` top-aligns to the ascender and reads visibly high; `center` is what was rejected.
- Operation type is a **colored dot with a tooltip**, never a text pill: green created, blue
  edited, red missing-on-disk. A text pill costs about 55px and crushes the filename to eight
  visible characters at 280px.
- Actions appear on hover and while expanded. A missing-on-disk row leads with Restore instead of
  Reveal, since revealing a file that is not there is useless.
- Rows expand on click. The expansion carries the existing `EditViewMode` chips
  (`content` / `added` / `removed` / `diff`), the full absolute path, and a jump-to-message arrow.
  Because the full path lives in the expansion, line 2 can elide aggressively.

### Path elision

Strip `project_cwd` from the front and render the remainder
(`skills/deliver-prd/references/TEMPLATE.md`, not the full `E:\Projects\...` path). Windows paths
compare case-insensitively to match the backend's own prefix check (`edits.rs:465`), and splitting
uses `split(/[\\/]/)`.

Keeping some directory context is load-bearing, not decorative: a real project routinely has
several `TEMPLATE.md` and `HISTORY.md` in different folders, and filename-only rows are
indistinguishable.

### Timestamps

Relative (`14h`) for per-file grouping, clock time (`14:22`) for per-edit grouping. A
chronological list needs ordering more than recency.

### Panel header

One row, no file count (the controls need the width):

- **Scope**: text segmented control, `Session` / `Project`. No icon reads as scope without a label.
- **Density**: icon-only segmented control, `AlignJustify` for compact and `Rows2` for full cards,
  each with `aria-label` and a tooltip. No density icon exists in the codebase today.
- **Options**: a `...` button opening a `DropdownMenu` with a **Group edits by** radio group
  (`File (latest state)` / `Edit (chronological)`), a **Show** radio group
  (`All files` / `Missing on disk only`), and `Undock to full page`.

### Row click target

The whole row expands. The jump-to-message arrow lives inside the expansion, so the mapping is
explicit rather than hidden and the expand target stays above the 24px minimum. In per-edit
grouping a row maps to exactly one message; in per-file grouping a row represents several edits,
so the arrow jumps to the most recent and its tooltip says so.

### Width

Resizable, default 340px (not the navigator's 280px). Min 260, max 520. Verified at 280px: the
path elides from the left while filename and counts hold.

## Panel dock

Recent Edits does not get a bespoke rail. It registers into a minimal dock:

```ts
groups: Array<{ tabs: PanelId[]; activeTab: PanelId; size: number }>
```

**This ships with exactly one group holding one tab, and the dock renders no chrome of its own.**
With a single registered panel there is no tab strip, so the docked panel is visually identical to
a bespoke rail: one `useResizablePanel`, one persisted open state, one `aside`, one skip link.

The array shape is the entire point. A second panel later means a tab strip appears
(`tabs.length > 1`); a split later means a second array element. Shipping this as a single
hard-coded panel instead would make the second panel a refactor and the third a rewrite. The
shape costs nothing now.

The dock renders as a sibling of `MessageNavigator` inside the `selectedSession` branch of
`AppLayout.tsx`. The header's Recent Edits button (`Header.tsx`, `handleLoadRecentEdits`) routes on
mode: `page` keeps today's `switchToRecentEdits()`, `docked` toggles the dock.

## Backend contract

```rust
#[tauri::command]
pub async fn get_recent_edits(
    project_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    session_file_path: Option<String>,  // NEW: scan only this JSONL
    grouping: Option<String>,           // NEW: "file" (default) | "edit"
) -> Result<PaginatedRecentEdits, String>
```

Both new params are optional, so existing callers and the stored WebUI contract keep working.

- `session_file_path`: canonicalize, then reject unless the result is inside `project_path`.
  Model validation and tests on `restore_file`. When present, skip the `WalkDir` and run
  `process_session_file_for_edits` on that one file.
- `grouping == "edit"`: skip the `latest_by_file` dedup, paginate `sorted_edits` directly, and base
  `has_more` on `total_edits_count` rather than `unique_files_count`. `unique_files_count` is still
  computed and returned.
- New field `message_uuid: Option<String>`, from the `RawLogEntry.uuid` already in scope in the
  parse loop (`edits.rs:57`). Powers the jump-to-message arrow.
- New field `exists_on_disk: bool`, one `fs::metadata(...).is_ok()` per **returned** row, after
  pagination. At `limit` 20 that is 20 stat calls, not 698.

**Payload note.** Each record already carries the full file content twice
(`content_after_change` plus `original_content`). Per-edit grouping does not make a single page
heavier, since a page is still `limit` records. What changes is that a file's content can repeat
across pages, which is acceptable at this page size.

**Parity.** Extend `RecentEditsParams` and the handler closure in `server/handlers.rs`. The route
path and read-only allowlist entry are unchanged. Per the PR checklist, a frontend-callable command
must be registered in both `generate_handler!` and the Axum router or `--serve` mode 404s.

## State

New slice `src/store/slices/recentEditsPanelSlice.ts`. `analytics.currentView === "recentEdits"`
continues to mean "the full page view is showing"; the dock is independent of it.

```ts
recentEditsMode: "page" | "docked"                 // default "page"
recentEditsDensityPage: "standard" | "compact"     // default "standard"
recentEditsDensityDock: "standard" | "compact"     // default "compact"
recentEditsScope: "project" | "session"            // default "session" when docked
recentEditsGroupingProject: "file" | "edit"        // default "file"
recentEditsGroupingSession: "file" | "edit"        // default "edit"
recentEditsMissingOnly: boolean                    // default false
isRecentEditsDockOpen: boolean                     // default false
```

- **Density is per mode**, two keys, never one. Docking must not re-densify the full page view.
- **Grouping is per scope**, so switching scope does not clobber the choice made in the other.
- **Fetch cache key** is `(projectPath, scope, grouping, sessionFilePath, offset)`.
- localStorage keys mirror the field names, plus `recent-edits-width` for `useResizablePanel`.
  Every read and write wrapped in try/catch with defaults on absent or corrupt values, following
  `navigatorSlice.ts`.

Because none of this lives in project or session state, persistence across selection changes falls
out for free. Test it explicitly anyway.

## i18n

New keys in `src/i18n/locales/*/recentEdits.json` for all five languages, then
`pnpm run generate:i18n-types` and `pnpm run i18n:validate`.

```
recentEdits.scopeSession        recentEdits.scopeProject
recentEdits.densityCompact      recentEdits.densityFull
recentEdits.panelOptions        recentEdits.moreActions
recentEdits.groupBy             recentEdits.groupByFile      recentEdits.groupByEdit
recentEdits.showFilter          recentEdits.showAll          recentEdits.showMissingOnly
recentEdits.undockToPage        recentEdits.dockToPanel
recentEdits.jumpToMessage       recentEdits.jumpToLatestEdit
recentEdits.missingOnDisk       recentEdits.scopeNeedsSession
```

Reused unchanged: `recentEdits.title`, `.diff`, `.created`, `.edited`, `.restoreFile`,
`.copyContent`, `.revealInExplorer` / `.revealInFinder` / `.revealInFolder`, `.showAddedLines`,
`.showRemovedLines`, `.showDiff`, `.loading`, `.noEdits`.

## Build order

| # | Step | Surface |
|---|---|---|
| 0 | Verify then fix the cache comparison. **Separate PR, lands first.** | store |
| 1 | `recentEditsPanelSlice` plus persistence plus tests | frontend |
| 2 | Path elision helper, Windows-safe, plus tests | frontend |
| 3 | Compact row: two lines, line-1 alignment, hover actions, expansion | frontend |
| 4 | Density and scope toggles on the `MetricModeToggle` pattern | frontend |
| 5 | Options menu on `DropdownMenuRadioGroup` | frontend |
| 6 | `session_file_path` and `grouping` params, Rust plus Axum parity plus tests | backend |
| 7 | `message_uuid` and `exists_on_disk` fields plus tests | backend |
| 8 | `PanelDock` with the groups array, one group, no tab strip; register Recent Edits | frontend |
| 9 | Wire scope, grouping and missing-only to the fetch with the new cache key | full stack |
| 10 | Jump-to-message via the existing `navigateToMessage(uuid)` | frontend |
| 11 | i18n across five locales, regenerate types, validate | i18n |

Steps 1 to 5 are visible without any backend work. Tests come first for steps 6 and 7.

## Acceptance

- The Recent Edits button toggles a right panel beside the transcript, resizable, default 340px,
  width persisted across reload.
- The docked panel defaults to compact and the page defaults to standard, and changing one
  provably does not change the other.
- With a session selected, `Session` scope shows only that session's edits and the row count
  differs from `Project`.
- In `Edit` grouping a file edited more than once appears more than once, chronologically, with
  clock-time stamps.
- Mode, density, scope, grouping and width survive switching project, switching session, and a
  full reload.
- A file deleted from disk shows the red dot, `Missing on disk only` filters to it, and its
  leading hover action is Restore.
- Expanding a row and clicking the arrow scrolls the transcript to the originating message; in
  per-file grouping it lands on the most recent edit for that file.
- Chevron, dot, filename, counts and time visually sit on one line, matching the visual reference.
- At 280px the path elides while filename and counts still render.
- Calling `get_recent_edits` without the two new params returns exactly today's shape and content.
- Verified in a real rendered view: `just serve-dev` with `--no-auth`, driven by Playwright,
  screenshots at 1280, 1440 and 1920, console clean.
- Gates: `pnpm exec tsc --build .`, `pnpm vitest run`, `pnpm lint`, `pnpm run i18n:validate`,
  `cargo test -- --test-threads=1`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo fmt --all -- --check`.

## Decisions taken without an explicit call

Implemented as stated unless overruled.

1. The dock appears in the transcript view only, not over Analytics, Token Stats or Board. This
   avoids having to define what session scope means with no session selected.
2. Desktop only. Mobile keeps the full page view via `BottomTabBar`, matching `MessageNavigator`.
   Compact density is still available on the page.
3. With no session selected the scope toggle is disabled with a tooltip
   (`recentEdits.scopeNeedsSession`) and forced to project scope, rather than hidden.
4. The cache fix is its own small PR landing first, since it is a one-line change with a
   measurable before and after.

## Risks

- The cache always-miss is inferred from reading, not measured. If step 0 shows the comparison
  somehow holds, the performance premise for prioritising it disappears, though the panel still
  works.
- Whether a Claude session's JSONL contains only edits belonging to that session is assumed, not
  proven. Scanning by file path sidesteps id drift but inherits whatever the file contains. Verify
  against a resumed session during step 6.
- `exists_on_disk` adds filesystem stats, which can be slow on network or cloud-synced drives.
  Bounded to `limit` rows per request, and it can be made lazy if profiling shows a problem.
- Two panels plus the sidebar is a width squeeze below 1440px. The dock caps growth at two rails
  rather than three; migrating `MessageNavigator` into the dock later would reduce it to one.
