# Messages panel: opt-in turn outline mode

> Status: draft for review. The author confirmed every product decision below on 2026-10-05.
> Date: 2026-10-04, revised 2026-10-05
> Issue: #598 (Messages panel proposal), Part 2
> Scope: `src/components/MessageNavigator/`, plus small, targeted additions to
> `MessageViewer.tsx` (a visibility-tracking effect), `navigatorSlice.ts`, `messageKinds.ts`
> (a `countToolUseBlocks` helper), and the five `message.json` locale files. `useNavigatorEntries.ts`
> was removed; its logic folded into `MessageNavigator.tsx` (see "As built," below). No change to
> how `MessageViewer.tsx` renders the transcript itself.
> Visual reference: [public mockup, Option A](https://jprisant.github.io/claude-code-history-viewer/)
> (navigator page; not virtualized, for illustration only)

## Background

Issue #598 proposed two changes to the Messages panel. Part 1, row kinds, already shipped: every
row now carries a kind (prompt, command, agent update, context, reply, tool, system, summary)
from `classifyMessage` in `src/components/MessageViewer/helpers/messageKinds.ts`. Part 2, a turn
outline, asked for direction before a spec. The maintainer answered three questions and all three
are fixed inputs to this spec, not open for reconsideration here.

1. "Outline mode: yes, opt-in. Keep today's flat list as the default and add the list/outline
   switch in the panel header. If it proves itself we can flip the default later."
2. "Person button: prompts + slash commands, as #600 already does - keep it."
3. "Icons vs. labels: keep the per-kind icons from #600 (with the label in the tooltip /
   accessible name)."

The approved proposal, quoted from issue #598 Part 2:

> An outline mode would group each turn under the prompt that started it. A closed turn shows the
> prompt and counts of what followed: replies, tool calls, agents started, and agent updates. An
> open turn shows one row per agent task instead of one row per update. In the session above, 43
> updates came from 11 tasks. The turn header stays pinned while you scroll through a long turn.
> A list/outline switch in the panel header keeps today's flat list available.

This spec covers only the outline mode body. The list/outline switch, the kind icons, and the
person button's existing prompts-plus-commands filter are prior art and stay as they are, except
where this spec says a mode needs a different reading of a shared control.

## Goals

1. An opt-in outline view groups the panel's rows by the turn each row belongs to.
2. A closed turn shows its starting prompt (or slash command) and four counts: replies, tool
   calls, agents started, and agent updates.
3. An open turn shows one row per agent task instead of one row per task-notification message.
4. The active turn's header stays visible while the reader scrolls through a long open turn.
5. The outline shows a turn containing the message currently in view in the main transcript.
6. The outline tells the reader when earlier messages have not loaded yet.
7. List mode is unaffected. Outline mode is off by default and persists once chosen.
8. The outline works in the narrow-screen bottom sheet, which renders the same component.

## Non-goals

- Changing the default view mode. The maintainer said list stays default until outline proves
  itself.
- "Open all" and "Close all" buttons. The mockup has both, but the approved proposal does not.
  In outline mode the person button already closes every turn, and list mode already shows every
  row.
- A duration label on the turn header (the mockup's "ran 4m"). Not asked for in the approved
  proposal.
- Distinguishing a background-command-sourced task from a Task-tool agent task in the outline.
  See Verified constraints: the two origins are not unified in today's code.
- A "Load earlier" action inside the outline. The main transcript already autoloads near its top;
  this spec only adds a notice.
- Re-deriving per-turn counts when the free-text filter is active. See Design: a non-empty filter
  falls back to the flat list.
- Layout code written only for narrow screens. The bottom sheet renders `MessageNavigator`
  unchanged, so the outline appears there with no extra code. The PR checks this at 390 px wide
  and states exactly what it tested and what it did not, rather than claiming mobile support in
  general.

## Verified constraints

Code-read on 2026-10-04 against `origin/develop`. Rechecked on 2026-10-05 against `develop` at
`e1789a79`, after PR #629 (prompt jump with Alt+ArrowUp/ArrowDown) and PR #630 (its follow-up
fixes for the project tree and dialogs) merged. All line numbers below are from `e1789a79`.

- `classifyMessage` returns a `MessageKind` and the deciding text block
  (`messageKinds.ts:198-212`). A message of kind `"tool"` carries `text: null`; its structured
  data lives on `toolUseResult` or a `tool_use`/`tool_result` content block.
- `parseTaskNotifications(text)` returns an array: one message can batch several
  `<task-notification>` blocks (`messageKinds.ts:86-97`; `agentTaskHelpers.ts:184` calls this
  "batched notifications"). Each block has `taskId`, `status`, `summary`, `result`. A
  `<tool-use-id>` tag exists in real transcripts (`messageKinds.test.ts:24`) but is not extracted;
  only `task-id`, `status`, `summary`, `result` are read (`readTag`, `messageKinds.ts:66-69`).
- `isFailedTaskStatus` treats `failed`, `error`, `killed`, `stopped` as not-succeeded
  (`messageKinds.ts:77-79`). `useNavigatorEntries.ts`'s `entryStatus` already picked "any failed
  status in this row's batch outranks, else the first status." (`entryStatus` now lives in
  `classifiedRows.ts`, where this build's fold-in moved it.) This spec's task-row
  rule (Design, below) keeps "failed outranks" across a whole task's lifetime, not one row's
  batch, and uses the most recent non-failed status instead of the first, for that reason.
- **Similar name, different rule.** `messageCategories.ts:34-40` defines a private, unexported
  `startsUserTurn` that only matches Codex provider messages. The shared predicate is a different
  function, `isTurnStart` (`messageKinds.ts:223`, added by PR #629), which is true for kind
  `"prompt"`, or kind `"command"` whose text contains `<command-name>`. PR #629 named it
  `isTurnStart` to avoid colliding with the Codex-only function. This spec imports only
  `isTurnStart` and never touches the Codex-only function.
- `getToolUseBlock` (`src/utils/messageUtils.ts:37-65`) returns the first `tool_use` block it
  finds, not a count, and `NavigatorEntryData.hasToolUse` is a boolean built from it. One assistant
  message can carry more than one `tool_use` block, so a "tool calls" count from row counts would
  undercount.
- A row of kind `"reply"` can also carry `tool_use` blocks. `classifyMessage` assigns `"reply"` to
  any assistant message with non-empty text, even one that also has tool calls
  (`messageKinds.ts:202-205`). `NavigatorEntry.tsx:108` already renders a second icon for exactly
  that case (`entry.hasToolUse && entry.kind !== "tool"`), so the codebase already treats a reply
  row's tool calls as real. A "tool calls" count built only from rows of kind `"tool"` would miss
  them. This spec counts `tool_use` blocks across every assistant row instead (see Design).
- `groupAgentTasks` (`agentTaskHelpers.ts:92`, exported) groups Task-tool launches
  (`toolUseResult.isAsync === true` plus `agentId`, lines 18-29) and links `<task-notification>`
  updates to them by matching `task-id` against `agentId`. Its batched-notification handling
  (lines 184-206) sets `task.status = "completed"` unconditionally on any linked update, never
  reading the update's real status, so a task that actually `failed` is reported `"completed"`.
  This spec does not use `groupAgentTasks`'s `status` field for that reason.
- A `<task-notification>` can come from "a background agent or command" (`messageKinds.ts:15`
  doc comment). `groupAgentTasks` only models the Task-tool launch path, so a command-sourced task
  has no launch message it can see. `isAgentTaskLaunchMessage` (lines 18-29) is not exported; only
  `groupAgentTasks` is. No code unifies both origins under one launch-detection path.
- `collectClaudeParallelTaskUuids` (`messageCategories.ts:76-101`, doc comment 76-82, function
  body 83-101) tags a message as `"parallel-task"` two ways: any message in a `groupAgentTasks`
  group with 2 or more tasks, and, unconditionally, any message matching `isTaskNotification`,
  regardless of task count. The accessibility test's "hides Parallel Tasks entries" case confirms a
  single-task notification row is hidden when the lightning toggle is off.
  `MessageNavigator.tsx:64-71` already applies this filter before building entries, so grouping
  code needs no special case for it. `userOnlyFilter` and `showParallelTasksInNavigator` both live
  in `filterSlice.ts:90-156`, not in `navigatorSlice.ts`, and `MessageNavigator.tsx` already reads
  both directly from `useAppStore()`.
- `NavigatorEntryData` has no "is this a turn start" field; `useNavigatorEntries.ts` never called
  `isTurnStart` (that hook no longer exists; see "As built," below).
- **Keyboard ownership of Alt+Arrow.** The prompt jump listens on `window`
  (`usePromptJump.ts:93`) and ignores any event already `defaultPrevented`
  (`usePromptJump.ts:79`). A panel handler that calls `preventDefault` on Alt+Arrow therefore
  breaks the prompt jump silently. `handleEntryKeyDown` avoids this by returning early when
  `event.altKey` is set (`MessageNavigator.tsx:154-156`). PR #630 fixed the same bug in the project
  tree with `getTreeNavigationKey` (`ProjectTree/treeKeyboard.ts`). Since PR #630, the prompt jump
  also ignores keys whose target is inside `[role='dialog']` or `[role='alertdialog']`.
- **The narrow-screen sheet is a second instance.** `src/components/mobile/MobileNavigatorSheet.tsx`
  renders its own `MessageNavigator` inside a Radix `Sheet` (`SheetContent` is a dialog), with
  its own local `isOpen` state (line 14). `AppLayout.tsx:960-961` mounts it only when `isMobile`.
  The desktop `MessageNavigator` stays mounted on narrow screens, hidden by `hidden md:block`, with
  `isCollapsed={!isNavigatorOpen}` (`AppLayout.tsx:818-827`). So `isNavigatorOpen` describes the
  desktop panel only, never the sheet. Tapping a row in the sheet calls `navigateToMessage` and
  leaves the sheet open. Because `SheetContent` is a dialog, Alt+Arrow inside the sheet does not
  jump between prompts; that is PR #630's intended rule, not an outline bug.
- `@tanstack/react-virtual` resolves to `3.14.10` per `pnpm-lock.yaml:1455`, matching
  package.json's `^3.14.10`. It depends on `@tanstack/virtual-core` at exactly `3.17.8`
  (`pnpm-lock.yaml:1461`). `node_modules` holds both packages. `react-virtual` is a top-level
  symlink under `node_modules/@tanstack`. `virtual-core` sits nested inside it, in the pnpm store,
  since pnpm does not hoist a transitive dependency. `react-virtual`'s own entry point re-exports
  it: `@tanstack/react-virtual/src/index.tsx:14` does `export * from '@tanstack/virtual-core'`. A
  caller imports both from one package this way. `@tanstack/virtual-core/src/index.ts` was read
  directly. `defaultRangeExtractor` is defined at lines 83-93. The `rangeExtractor` option's type,
  `(range: Range) => Array<number>`, is declared at line 360. `defaultRangeExtractor` is wired in
  as that option's own default at line 541. The virtualizer calls `rangeExtractor` with
  `{ startIndex, endIndex, overscan, count }` at lines 1456-1464. This spec's claim about
  `rangeExtractor`'s shape is verified against this installed code. It is not inferred from public
  docs.
- `FloatingDateOverlay.tsx:1-10` states directly: "Since @tanstack/react-virtual uses
  `position: absolute` for rows, CSS sticky doesn't work. Instead, we track the first visible
  virtual item..." `MessageNavigator.tsx` positions every row the same way (absolute, translateY).
  This is the codebase's own prior conclusion against a naive sticky header for an analogous case.
- `MessageViewer.tsx:612-618` computes the true first visible row as `row.start + row.size >
  scrollTop`, filtered to `type === "message"`, excluding overscan. `FloatingDateOverlay.tsx`
  instead reads `virtualRows[0].index`, which can include overscan. This spec's visible-turn
  mechanism follows the `MessageViewer.tsx:612-618` form.
- `docs/specs/issue-36-message-navigator.md` section 2.5 planned "active scroll tracking" as a
  Phase 2 follow-up. A repo-wide search for `visibleRange`, `firstVisible`, `activeNavigatorUuid`,
  and `rangeExtractor` outside `MessageViewer.tsx` and `FloatingDateOverlay.tsx` finds nothing:
  section 2.5 was never built for the navigator.
- `PaginationState.hasMore` (`src/types/message.types.ts:315-321`) and its doc comment
  (`message.types.ts:306-314`): offsets count "from the NEWEST end of the session." `loadMoreMessages`
  loads "the next (older) page... and prepend[s] it" (`messageSlice.ts:76-77`). While `hasMore` is
  true, any row the loaded window shows before its first detected turn start belongs to a turn
  whose prompt has not loaded.
- `navigatorSlice.ts` persists one boolean (`isNavigatorOpen`) to `localStorage` under
  `"navigator-open"`, inside try/catch (lines 24-42). The new `navigatorViewMode` field follows
  this exact pattern.
- `src/layouts/AppLayout.tsx:819-827` renders `<MessageNavigator messages={messages} .../>` with
  the same `messages` array `MessageViewer` receives: the loaded window, not the full session.

## Design

### Turn-start predicate (imported, not redefined)

The outline groups rows with `isTurnStart` from `messageKinds.ts`, exactly as the prompt jump
uses it: true for kind `"prompt"`, and for kind `"command"` whose text contains `<command-name>`.
Local command output is also kind `"command"` but does not start a turn. This spec's code imports
`isTurnStart` and never adds a second definition.

`isTurnStart` takes a `MessageKindInfo`, not a `ClaudeMessage`:
`isTurnStart(info: MessageKindInfo): boolean` (`messageKinds.ts:223`). A caller holding only a
raw message classifies it first, the way `promptJump.ts:18` already does:
`isTurnStart(classifyMessage(message))`. This spec's own grouping code holds both `message` and
its already-computed `info` on every row (below), so it calls `isTurnStart(info)` directly and
never re-classifies a row it has already classified.

### A shared, filtered, classified row list

`useNavigatorEntries.ts` filtered out `NOISE_TYPES` and empty messages, then classified each row,
before this build folded the hook into `MessageNavigator.tsx` (see "As built," below). The new
grouping code needs that same filtering plus the raw `ClaudeMessage` (for `toolUseResult`, full
`content`, `timestamp`), not only the already-summarized `NavigatorEntryData`. Extract a shared
step, `getFilteredClassifiedMessages(messages: ClaudeMessage[]): ClassifiedRow[]`, in a new file
`classifiedRows.ts`, where `ClassifiedRow = { message: ClaudeMessage; info: MessageKindInfo;
entry: NavigatorEntryData }`. `MessageNavigator.tsx` calls it once and feeds the result to both
the flat list and the new outline grouping, so the noise-filter rule cannot drift between the two
views.

Both consumers receive `MessageNavigator.tsx`'s `navigatorMessages`: `messages` already passed
through `filterMessagesByCategory(messages, "parallel-task", showParallelTasksInNavigator)`. The
lightning toggle needs no special case in the grouping code: turning it off removes parallel-task
rows before grouping runs, so "agent updates" and "agents started" drop automatically.

### Grouping algorithm: `groupTurns`

A new pure function, `groupTurns(rows: ClassifiedRow[]): TurnGroup[]`, in a new file
`src/components/MessageNavigator/outline/groupTurns.ts`. Pure so its unit tests need no React.
`rows` is the shared step's own output (above), so `groupTurns` needs no separate raw-message
argument.

1. Walk `rows` in order. Record the index of every row where `isTurnStart(info)` is true, using
   that row's own `info` field. These are turn-start boundaries.
2. Before the first boundary (or if there is no boundary at all), rows form the **leading group**,
   with `turnStartUuid: null`.
3. Each boundary starts a turn running up to the next boundary (exclusive). A turn's own prompt or
   command row becomes its header; the turn's `children` exclude that row, since the header
   already stands for it.
4. For each turn, compute the four counts (below) and build the list of open-turn child rows
   (below) from that turn's slice of `rows`.
5. Return `TurnGroup[]`: `{ key: string; turnStartUuid: string | null; turnNumber: number | null;
   header: NavigatorEntryData | null; firstUuid: string; counts: TurnCounts; children:
   OutlineChildRow[]; uuids: string[] }`. `header` is the turn-start row's own entry, `null` for
   the leading group. `firstUuid` is the group's first row, used as a fallback target when there
   is no `turnStartUuid` to navigate to (see "Pinned turn header," below). `uuids` lists every row
   in the group, header included. `turnNumber` is 1-based, counting only real turn starts in the
   loaded window, and is `null` for the leading group.

`useOutlineTurns.ts` wraps `groupTurns` in `useMemo`, keyed on the filtered row list, matching the
filtered-row memoization that now lives in `MessageNavigator.tsx` (the `classifiedRows` `useMemo`,
where `useNavigatorEntries.ts`'s own memoization moved).

### Per-turn counts

Computed over a turn's slice of classified rows:

- **Replies**: count of rows with `kind === "reply"`.
- **Tool calls**: sum, over every assistant row in the turn (kind `"reply"` or `"tool"`), of that
  message's `tool_use` block count. A new helper, `countToolUseBlocks(message): number`,
  generalizes the existing `hasToolUse` boolean check in `messageKinds.ts` (line 136) to a count:
  the number of `content` blocks with `type === "tool_use"`, when any exist; otherwise 1 if
  `message.toolUse` is set, else 0. `content` is checked first, and `toolUse` is only a fallback,
  because the backend (`load.rs`) backfills `toolUse` from just the first `tool_use` block, so a
  set `toolUse` does not mean there was only one call. Counting by row kind alone would miss a
  `"reply"` row's own tool calls (Verified constraints), so this count sums across both kinds, not
  `"tool"` rows only.
- **Agent updates**: count of rows with `kind === "agent-update"`.
- **Agents started**: size of the set of defined `taskId` values across every
  `parseTaskNotifications(info.text)` call on the turn's agent-update rows. This counts distinct
  tasks that sent at least one update, not distinct launches. A task still running with zero
  updates so far is not counted. See Risks.

### One row per agent task

When a turn is open, every agent-update row is replaced by one row per task, not shown
individually.

1. Walk the turn's agent-update rows in order. Call `parseTaskNotifications(info.text)` on each,
   which can return more than one block.
2. Key each block by its `taskId`. A block with no `taskId` gets its own one-block group, keyed by
   its row UUID plus block index, since there is no stable ID to merge it by.
3. A task row is created the first time its key appears, at that position in the turn's row order.
   Later blocks for the same key add to the existing row's data; they never add a new row.
4. A task row shows four things.
   - **Label**: the last non-empty `summary` across the task's blocks. Falls back to
     `navigator.outline.taskUnnamed` with the ID truncated to 8 characters.
   - **Update count**: the number of notification blocks in the group, not the number of rows,
     since one row can hold several blocks.
   - **Status color**: any block with `isFailedTaskStatus` true outranks, regardless of position.
     Otherwise, the most recent status by turn order wins. This diverges from `classifiedRows.ts`'s
     `entryStatus`, which falls back to the first status in one row's batch. A task's status
     progresses over its lifetime, so the latest reading is the useful one.
   - **Activation**: navigates to the row holding the task's last notification block, not its
     first.
5. A task row does not say whether its task is a background command or a Task-tool agent: the two
   origins are not unified in today's code (Verified constraints).

### Leading group and the "not loaded" notice

The leading group (rows before the first turn start) renders as a turn-like header, always
present when non-empty, with the same four counts as a real turn.

- If `pagination.hasMore` is true, its header text is `navigator.outline.earlierNotLoaded`
  ("Earlier messages have not loaded yet"), because the window's pagination comment confirms
  older messages exist and have not been fetched. Every real turn's own header also switches from
  `navigator.outline.turnLabel` ("Prompt {{n}} of {{total}}") to
  `navigator.outline.turnLabelLoaded` ("Prompt {{n}} of {{total}} loaded") while `hasMore` is
  true, since `total` then counts only loaded turns, not the whole session.
- If `pagination.hasMore` is false, its header text is `navigator.outline.beforeFirstPrompt`
  ("Before your first prompt"), because this is a true session start with no load pending, and
  every turn header uses plain `turnLabel`.
- The notice is informational only. It does not call `loadMoreMessages`. The main transcript
  already autoloads near its top; adding a second trigger risks a double fetch.
- The leading group is never marked as the active (in-view) turn, since it has no prompt to
  navigate to from the main view.

### Pinned turn header

The approved proposal asks for the open turn's header to stay visible while scrolling through it.
`FloatingDateOverlay.tsx`'s own comment says CSS `position: sticky` does not work against this
codebase's `position: absolute` virtual rows (Verified constraints, above). This spec follows the
same floating-overlay technique that file already uses, rather than a `rangeExtractor` plus
conditional `position: sticky` row.

The outline's virtualizer computes its own true first visible row, using the
`MessageViewer.tsx:612-618` form (`row.start + row.size > scrollTop`), not `virtualRows[0]`. If
that row belongs to an open turn's children, a `PinnedTurnHeader` overlay renders, absolutely
positioned at the top of the navigator's scroll container, showing that turn's header content. If
the first visible row is already a turn header, no overlay renders.

Clicking or tapping the overlay calls `navigateToMessage` with the turn's `turnStartUuid`, so the
main transcript scrolls to that turn's prompt. The leading group has no `turnStartUuid`, since it
has no prompt of its own; its overlay instead navigates to `firstUuid`, the group's own first row.
Clicking the overlay does not toggle the turn, and it does not scroll the outline. The turn's own
header row stays the one control that opens and closes the turn. In the narrow-screen sheet, the
same overlay is the touch target for this action.

This needs its own component test: `src/test/MessageNavigator.accessibility.test.tsx` mocks
`useVirtualizer` with a stub returning every row, with no real scroll position to test against.
That stub's rows carry only `index` and `start`, with no `size` field, so this pinned-header test
cannot reuse it unchanged; it needs sizes added (see Risks).

### Highlighting the turn in view

No mechanism tracks "the message currently visible in the main transcript" today (Verified
constraints). The minimal addition:

Add `visibleMessageUuid: string | null` and `setVisibleMessageUuid` to `navigatorSlice.ts`, not
persisted. In `MessageViewer.tsx`, lift the `row.start + row.size > scrollTop` find already
written for `handleLoadEarlier` into its own effect, run on virtual-item or scroll changes and
throttled to a few updates per second, that calls `setVisibleMessageUuid`.

The lookup skips a row that peeks in by less than 16 pixels at the top edge, falling back to the
plain `row.start + row.size > scrollTop` rule only when nothing else is in view
(`src/components/MessageViewer/helpers/visibleMessage.ts`). Without that tolerance, a
fractional-height row barely crossing the top edge could claim the highlight that belonged to the
turn above it.

Gate the effect on outline mode only (`navigatorViewMode === "outline"`), not on
`isNavigatorOpen`. That flag describes the desktop panel and never the narrow-screen sheet
(Verified constraints), so gating on it would freeze the highlight inside the sheet. List mode
costs nothing extra. In outline mode the effect also runs while the panel is collapsed; it is one
throttled `find` over the virtualizer's rendered rows, so this cost is small.

`visibleMessageUuid` can name a row the outline never renders at all: a noise type, an empty
message, or a parallel-task row hidden by the lightning toggle (Verified constraints). A lookup
against `filteredRows`'s own index would miss that row for the same reason `NavigatorEntryData`
does, since both are filtered the same way before either is built.

Instead, build `turnOfMessage: Map<string, string | null>` by walking the raw `messages` array
`MessageNavigator.tsx` receives, in render order. Keep a running `currentTurnStartUuid: string |
null`, starting at `null`. For each message in turn, check whether its uuid is one of the
`turnStartUuid` values in the `TurnGroup[]` that `groupTurns` returned for this render. If it is,
set `currentTurnStartUuid` to that uuid first. Then map this message's own uuid to whatever
`currentTurnStartUuid` holds now. This check never re-runs `isTurnStart`; it only tests
membership in `groupTurns`'s own output, so the map and the outline can never disagree about where
a turn starts. A message before the first turn start maps to `null`, matching the leading group.

Look up `visibleMessageUuid` in `turnOfMessage` to get the active turn's `turnStartUuid`. A `null`
result means either there is no visible message yet, or it falls in the leading group; either way
clear the highlight, since the leading group never receives it (see "Leading group and the 'not
loaded' notice," above). A matched turn's header gets the active styling the flat list already
uses for `entry.uuid === targetMessageUuid` (`border-l-accent bg-accent/5` in `NavigatorEntry.tsx`).

### Free-text filter in outline mode

A non-empty filter suspends grouping. Outline mode shows the same filtered flat list that list
mode already shows, using the existing preview-plus-kind-label match. The outline resumes when
the filter is cleared. See Decisions, below, for the alternative this spec did not pick.

### Person button and lightning button in outline mode

- **Lightning (parallel tasks)**: unchanged. It filters `messages` before grouping even sees them
  (Verified constraints), so no outline-specific code is needed.
- **Person button (prompts + commands only)**: in outline mode every turn header is already a
  prompt or a command by construction, so row-level filtering has nothing to remove. Turning the
  toggle on instead closes every currently open turn, a one-time action, not a standing filter.
  Turning it off does not reopen anything. Each turn still opens with a click. The toggle's
  boolean state (`userOnlyFilter`) is shared with list mode; only its effect differs by mode.
- **The person button says what it does in each mode.** In outline mode, the button's `title` and
  `aria-label` both read `navigator.outline.closeAllTurns` ("Close all turns") instead of
  `navigator.userOnly` ("Show my prompts only"). The button is icon-only, so its accessible name
  must describe its current effect, and one button must not silently do two different things. The
  `title` keeps its second line, the prompt-jump hint, in both modes. `aria-pressed` still
  reflects the shared `userOnlyFilter` boolean.
- **The label and the action follow the view actually rendered, not the mode flag.** A non-empty
  free-text filter falls back to the flat list even while `navigatorViewMode === "outline"` (see
  "Free-text filter in outline mode"). While that fallback is in effect, the person button reverts
  to "Show my prompts only" and filters rows the normal way; "Close all turns" only shows, and only
  fires, while the outline is the view actually on screen.

## State

`navigatorSlice.ts` gains two fields, following its existing try/catch localStorage pattern:

```ts
navigatorViewMode: "list" | "outline"   // default "list", persisted, key "navigator-view-mode"
visibleMessageUuid: string | null       // default null, not persisted
```

Open/closed turn state is local component state in `MessageNavigator.tsx`
(`useState<Set<string>>`), not persisted. A session change resets it to empty.

An effect opens turns on the reader's behalf, tracked by an `openedForRef` marker of the last
session and target it already acted on, so it runs at most once per session-and-target pair:

- On a session's first load, the target's turn opens, even when the target is itself a turn
  header.
- After that first load, only a target that is a turn's child opens its turn. A header target is
  already visible once its turn exists in the outline, so opening it again would expand every
  turn the reader jumps through, and it would stop a header click from ever closing its own turn.
- A target whose messages have not loaded yet - no turn in the current `turns` list contains it -
  is left alone; the effect tries again on the render where that turn appears.

This matches the existing pattern: `filterText` and `focusedIndex` are also local, unpersisted
state in the same file.

## i18n

New keys go into `src/i18n/locales/*/message.json` for all five languages (en, ko, ja, zh-CN,
zh-TW) with real translations, as PR #629 did for `navigator.promptJumpHint`. Then run
`pnpm run generate:i18n-types` and `pnpm run i18n:validate`. English text:

There is no `navigator.viewMode.list` key. The list/outline switch is one toggle button, not a
pair of labeled options, so it needs only the outline-side name plus a shared hint:

```
navigator.viewMode.outline              "Outline view"
navigator.viewMode.toggle               "Switch between list and outline view"
navigator.outline.turnLabel             "Prompt {{n}} of {{total}}"
navigator.outline.turnLabelLoaded       "Prompt {{n}} of {{total}} loaded"
navigator.outline.beforeFirstPrompt     "Before your first prompt"
navigator.outline.earlierNotLoaded      "Earlier messages have not loaded yet"
navigator.outline.replies_one           "{{count}} reply"
navigator.outline.replies_other         "{{count}} replies"
navigator.outline.toolCalls_one         "{{count}} tool call"
navigator.outline.toolCalls_other       "{{count}} tool calls"
navigator.outline.agentsStarted_one     "{{count}} agent started"
navigator.outline.agentsStarted_other   "{{count}} agents started"
navigator.outline.agentUpdates_one      "{{count}} agent update"
navigator.outline.agentUpdates_other    "{{count}} agent updates"
navigator.outline.taskUpdates_one       "{{count}} update"
navigator.outline.taskUpdates_other     "{{count}} updates"
navigator.outline.taskUnnamed           "Task {{id}}"
navigator.outline.jumpToTurn            "Jump to this turn's prompt"
navigator.outline.closeAllTurns         "Close all turns"
```

The count keys use i18next's plural suffixes (`_one`/`_other`) rather than one interpolated
string, since English, Korean, Japanese, and the two Chinese locales do not all pluralize the
same way.

Reused unchanged: `navigator.kind.*` for row icons inside an open turn, `navigator.userOnly`,
`navigator.promptJumpHint`, `navigator.showParallelTasks`, `navigator.filter`,
`navigator.noMessages`, `messageViewer.noSearchResults` for the filtered-empty state.

## Accessibility

List mode keeps its current roles exactly as they are today: `role="option"` on each row
(`NavigatorEntry.tsx:88`), and `role="listbox"` on the scroll container that holds them
(`MessageNavigator.tsx:336`). `src/test/MessageNavigator.accessibility.test.tsx` stays green
unchanged.

Outline mode uses tree semantics, flattened rather than nested:

- The scroll container gets `role="tree"`.
- Each turn header gets `role="treeitem"`, `aria-level="1"`, `aria-expanded`, `aria-posinset`, and
  `aria-setsize`.
- An open turn's children render as sibling `role="treeitem"` rows with `aria-level="2"`,
  `aria-posinset`, and `aria-setsize`. There is no `role="group"` wrapper: the virtualizer
  (`@tanstack/react-virtual`) positions every row absolutely, the same way list mode and
  `MessageViewer.tsx` already do, so DOM nesting under a group element is not possible
  (`NavigatorOutline.tsx`, `OutlineTurnHeader.tsx`).
- Roving focus uses the same single-`tabindex="0"` mechanism `MessageNavigator.tsx` already has,
  over a flattened list of visible rows: headers, plus the children of open turns only.
- ArrowDown and ArrowUp move through that same flattened list, unchanged from today.
- ArrowRight on a closed header opens it; on an open header, moves focus to its first child.
- ArrowLeft on an open header closes it; on a child, moves focus to its parent header.
- Enter or Space on a header does both: calls `navigateToMessage` for that turn's starting row,
  and toggles it open or closed, matching the mockup's click behavior exactly.
- Enter or Space on a child row navigates only, matching today's flat-list behavior.
- Each arrow-key handler acts on the row named by the key event's own `data-index` attribute, not
  on a possibly stale `focusedIndex` state value: a navigation can move the focus index to a new
  target while DOM focus itself stays on the row the reader just clicked
  (`outline/NavigatorOutline.tsx`, `handleRowKeyDown`).
- After the visible rows change - a turn opens or closes, or "Close all turns" fires - focus
  follows the same row by its key if that row still exists; otherwise it falls back to that row's
  parent turn header; otherwise the index clamps to the new row count
  (`outline/rovingFocus.ts`, `resolveFocusAfterRowsChange`).
- A custom `rangeExtractor` keeps the row holding `tabIndex="0"` mounted even after it scrolls out
  of the virtualizer's own rendered range, so Tab can still reach the tree
  (`outline/rovingFocus.ts`, `includeIndex`).
- Every outline key handler returns early when `event.altKey` is set, before any
  `preventDefault`, exactly as `handleEntryKeyDown` does today (Verified constraints). This
  covers ArrowLeft and ArrowRight too. Alt+ArrowUp and Alt+ArrowDown belong to the prompt jump,
  and Alt+ArrowLeft and Alt+ArrowRight are the browser's Back and Forward keys in the WebUI.
- The pinned header overlay sits outside the `role="tree"` element, as a sibling, the same way
  `FloatingDateOverlay` sits outside `MessageViewer`'s own list rather than inside it as a row. It
  is a real button, not a decoration, with `aria-label` from `navigator.outline.jumpToTurn`.

## Build order

| # | Step | Depends on |
|---|---|---|
| 1 | Import `isTurnStart` from `messageKinds.ts` (on `develop` since PR #629) | - |
| 2 | Extract `getFilteredClassifiedMessages` into `classifiedRows.ts`; `MessageNavigator.tsx` calls it directly (`useNavigatorEntries.ts` removed and folded in), tests updated | 1 |
| 3 | `countToolUseBlocks` helper plus tests | - |
| 4 | `groupTurns` pure function plus types plus tests (red first) | 1, 2, 3 |
| 5 | `useOutlineTurns` hook | 4 |
| 6 | `navigatorViewMode` field plus persistence plus tests | - |
| 7 | List/outline switch button in the panel header | 6 |
| 8 | Turn header row, task row, leading-group row components, closed-state rendering | 5 |
| 9 | Open/closed local state, flattened visible-rows builder for outline virtualizer | 8 |
| 10 | `visibleMessageUuid` field, `MessageViewer.tsx` throttled effect gated on outline mode, `turnOfMessage` map, active-turn lookup | 4 |
| 11 | `PinnedTurnHeader` overlay component plus test | 9, 10 |
| 12 | Tree accessibility: roles, roving focus, Left/Right, Enter/Space dual action, Alt early return | 8, 9 |
| 13 | Person button's outline-mode effect, tooltip, and accessible name; free-text-filter fallback | 7 |
| 14 | i18n keys translated in all five locales, regenerate types, validate | 8, 13 |
| 15 | Component tests: switching modes, counts, task grouping, pinned header, a11y | all |
| 16 | WebUI check, including 390 px wide and Alt+Arrow with focus in each panel and in a dialog | all |

Steps 1 through 7 need no turn-rendering work. Tests come first for steps 3 and 4, the two pieces
with no React involved.

**Tests, named**: `outline/groupTurns.test.ts` (boundaries, leading group, counts, task grouping,
status precedence); new `countToolUseBlocks` cases added to the existing `messageKinds.test.ts`
(including a `"reply"` row that also carries a `tool_use` block, there is no separate
`countToolUseBlocks.test.ts` file); `navigatorSlice.test.ts` (new fields); `classifiedRows.test.ts`,
`outline/flattenOutline.test.ts`, `outline/pinnedTurn.test.ts`, `outline/turnOfMessage.test.ts`,
`outline/useOutlineTurns.test.ts`, `outline/rovingFocus.test.ts`, and `visibleMessage.test.ts`; and
a new `src/test/MessageNavigator.outline.test.tsx` (mode switch, open/close, pinned header click,
highlight, a highlight test for a `visibleMessageUuid` the outline does not render, the person
button's outline-mode name, tree roles, roving focus, Left/Right/Enter/Space, and Alt+Arrow passing
through from an outline row without `preventDefault`). `src/test/MessageNavigator.accessibility.test.tsx`
was left unchanged; it gained no new cases (see "As built," below).

## Acceptance

1. The panel header shows a list/outline switch, off by default on first load, and persists
   across reload, project switch, and session switch.
2. A closed turn shows its prompt or slash command text and four counts: replies, tool calls,
   agents started, agent updates. A count of zero is omitted, not shown as zero. The tool-calls
   count includes `tool_use` blocks on the turn's `"reply"` rows, not only its `"tool"` rows,
   verified against a fixture where a reply row carries a tool call.
3. Clicking a closed turn's header opens it and navigates the main transcript to that prompt.
4. An open turn shows one row per distinct task ID among its agent-update rows, not one row per
   message. A task row's update count matches the number of notification blocks for that task,
   verified against a fixture with a batched multi-task message.
5. A task row whose blocks include any failed status shows failed, even when a later block in the
   same task reports a different non-failed status.
6. Scrolling through a long open turn keeps that turn's header visible, either as the real header
   or the pinned overlay, never neither. Clicking the overlay scrolls the main transcript to the
   turn's prompt and leaves the turn open.
7. The outline highlights the turn containing the message currently visible in the main
   transcript, verified by scrolling the transcript and observing the outline highlight move.
8. The outline still highlights the correct turn when the visible message is one the outline does
   not render itself: a noise type, an empty message, or a row hidden by the lightning toggle.
9. When `pagination.hasMore` is true, the leading group reads "Earlier messages have not loaded
   yet." When false, it reads "Before your first prompt."
10. The lightning toggle removes parallel-task rows from the outline's counts and task rows, with
    no outline-specific code path, verified on a session with parallel tasks.
11. In outline mode, the person button closes every open turn and filters no rows. Its tooltip and
    accessible name read "Close all turns", and the tooltip keeps the prompt-jump hint line. In
    list mode both read "Show my prompts only", as today.
12. A non-empty free-text filter shows the flat list in both view modes; clearing it restores the
    outline.
13. With focus on any outline row, Alt+ArrowUp and Alt+ArrowDown still jump between prompts in the
    main transcript. No outline key handler calls `preventDefault` on an Alt+Arrow key.
14. In the WebUI at 390 px wide, the outline appears in the narrow-screen sheet, turns open and
    close by tap, and a tap on the pinned header scrolls the transcript to the prompt. The PR lists
    which of these were exercised and what was not tested on a narrow screen.
15. `src/test/MessageNavigator.accessibility.test.tsx` passes unchanged, with no new cases added
    to it. New tests covering tree roles, roving focus, and Left/Right/Enter/Space in outline mode
    live in `src/test/MessageNavigator.outline.test.tsx` instead.
16. Gates: `pnpm exec tsc --build .`, `pnpm exec vitest run`, `pnpm lint`,
    `pnpm run i18n:validate`.

## Decisions

The author confirmed each of these on 2026-10-05.

1. **A non-empty free-text filter falls back to the flat list.** *Alternative:* hide non-matching
   turns and force-open matching ones. Rejected for v1: "does a turn match if any child matches"
   needs its own design pass, and the fallback ships something correct today.
2. **The person button closes open turns as a one-time action, shares its boolean with list mode,
   and says "Close all turns" in outline mode.** *Alternatives:* hide the button in outline mode,
   or give outline mode its own boolean. Rejected: the header has one button, and the mockup's own
   code only clears open turns when the toggle turns on. The mode-specific tooltip and accessible
   name keep one button from silently doing two different things.
3. **"Agents started" counts distinct task IDs in agent-update rows, not actual launches, and task
   rows do not label a task "Agent" or "Command."** *Alternative:* count the tool calls that
   launched agents, via `groupAgentTasks`. Rejected: that function only models the Task-tool path
   and would silently undercount command-sourced tasks, which the data model allows (Verified
   constraints).
4. **"Tool calls" counts every `tool_use` block, including those on reply rows.** *Alternative:*
   count the replies that made at least one call. Rejected: it does not match the label "tool
   calls."
5. **Clicking the pinned header overlay scrolls the main transcript to the turn's prompt; it does
   not toggle the turn.** *Alternative:* clicking it opens or closes the turn. Rejected to keep one
   control, the real header, responsible for opening and closing.
6. **The "earlier messages not loaded" notice is informational, with no load action.**
   *Alternative:* a clickable notice calling `loadMoreMessages`. Rejected to avoid a second trigger
   racing the main transcript's own near-top autoload.
7. **Open/closed turn state is unpersisted, local component state.** *Alternatives:* remember it
   while the app runs, or save it to disk. Rejected to match `filterText` and `focusedIndex`'s
   existing unpersisted pattern in the same file; the value of remembering is low.
8. **"Open all" and "Close all" are out of scope.** The mockup has both; neither is in the
   approved proposal's quoted text, and the person button already closes every turn.
9. **The outline works in the narrow-screen sheet with no narrow-only code.** *Alternative:* hide
   the list/outline switch on narrow screens. Rejected because the sheet renders the same
   component. The PR checks the sheet at 390 px and reports exactly what it tested, because
   nobody has confirmed how well the app works on narrow screens in general.

## Risks

- A task with no update yet is invisible to the "agents started" count and to the per-task rows,
  inherent to counting from agent-update rows rather than a true launch signal (decision 3).
- `groupTurns` adds a second place that reasons about turn boundaries, beside the prompt jump's
  own use of `isTurnStart` for Alt+ArrowUp/ArrowDown. A future change to what counts as a turn
  start must stay correct in both places.
- The shared `userOnlyFilter` boolean now has two different effects depending on view mode. The
  mode-specific tooltip tells the user; a future reader of `filterSlice.ts` will not see it from
  the slice, because it lives in `MessageNavigator.tsx`.
- `src/test/MessageNavigator.accessibility.test.tsx`'s `useVirtualizer` mock returns items with only
  `index` and `start`; it has no `size` field. The pinned header and the `visibleMessageUuid`
  effect both key off `row.start + row.size`. This mock gives that shape no coverage until build
  step 9 adds a virtual-item smoke test with real sizes.
- In the narrow-screen sheet, a tap navigates the transcript behind the sheet while the sheet
  stays open, exactly as list mode does today. The 390 px check records whether that is usable;
  this spec does not change it.

## As built (deviations from the draft)

PR #632 shipped this spec in commits 573d5b62, 1c332759, and 4cbc8fac. Each line below names
what changed from this draft and why.

- **The tree is flat, not nested.** There is no `role="group"` wrapper around a turn's children.
  The virtualizer positions every row absolutely, so DOM nesting was never possible; `aria-level`,
  `aria-posinset`, and `aria-setsize` on each `role="treeitem"` carry the hierarchy instead.
- **`useNavigatorEntries.ts` was deleted.** Its filtering, classifying, and memoizing logic folded
  into `MessageNavigator.tsx` and a new `classifiedRows.ts`, since the outline and the flat list
  needed to share one pass over the messages, not two hooks each doing their own.
- **The row types grew fields the draft did not sketch.** `ClassifiedRow` carries `entry`
  alongside `message` and `info`. `TurnGroup` carries `key`, `header` (not a `headerText` string),
  `firstUuid`, and `uuids`. The pinned header needs `firstUuid` as a fallback target when there is
  no `turnStartUuid`, and opening the target's turn needs `uuids` to find which turn holds a
  message (`findTurnKeyForUuid` in `outline/flattenOutline.ts`).
- **`countToolUseBlocks` checks `content` before `toolUse`, not the reverse.** The backend
  (`load.rs`) backfills `toolUse` from only the first `tool_use` block, so counting `toolUse`
  first would have undercounted any message with more than one call.
- **The pinned overlay needs a fallback target for the leading group.** The leading group has no
  `turnStartUuid`, so its pinned overlay navigates to `firstUuid` instead. The leading group's own
  header row only opens and closes the group, like every other header row.
- **The panel header's count switches meaning in outline mode.** It shows the number of turns
  (`realTurnsCount`) instead of the number of visible rows, so the count still means "how much is
  here" once rows collapse into turns. The draft did not specify this display.
- **The person button's label and action follow the rendered view, not the mode flag.** A
  non-empty filter falls back to the flat list even while outline mode is selected, and the button
  follows that fallback, not `navigatorViewMode` alone.
- **The in-view highlight needed a 16-pixel top-edge tolerance.** Without it, a fractional-height
  row barely crossing the scroll edge stole the highlight from the turn above it. The browser check
  found this; the fix is in commit 4cbc8fac.
- **Opening a turn for the current target needed stateful rules, not a one-time initial value.**
  A session's first load opens the target's turn even if the target is a header; after that, only
  a child target opens its turn, so a header click can still close its own turn; a target not yet
  loaded waits for a later render.
- **Roving focus needed three hardening rules not in the draft.** Arrow keys act on the row named
  by the event's own `data-index`, not a possibly-stale focus index; focus follows its row by key
  after rows change, falling back to the parent header; a custom `rangeExtractor` keeps the
  focused row mounted so Tab can still reach it. The browser check found the first; an adversarial
  review found the other two.
- **Test coverage landed differently than planned.** `src/test/MessageNavigator.accessibility.test.tsx`
  was never touched; every new accessibility, roving-focus, and mode-switch test lives in
  `src/test/MessageNavigator.outline.test.tsx` plus colocated unit tests next to each new module.

## Open questions

1. Should task rows eventually unify the Task-tool and background-command launch paths, to make
   "agents started" exact and to label a row "Agent" or "Command"? Needs a new export from
   `agentTaskHelpers.ts` at minimum.
2. Follow-up: should the free-text filter get outline-aware matching (decision 1's rejected
   alternative) once the simpler fallback ships and usage shows whether it is missed?
3. The outline does not scroll itself to keep the in-view (highlighted) turn header visible when
   the main transcript scrolls, and list mode does not do this either. Should either view gain
   that behavior?
