# Spec: real-message-pagination

- Status: In progress
- Created: 2026-07-12

## Problem / goal

Original ask (verbatim):

> 현재 해당 서비스의 기능들을 전부 나열하고 데이터가 많아짐에 따라 UIUX적으로 문제가 되거나 최적화가 필요한 부분 찾아줘
> 우선순위대로 나열해서 견고하게 진행

Priority item P1 (of 5): opening a session must no longer load the ENTIRE
message set into memory / over IPC. `messageSlice.selectSession` currently
calls `load_provider_messages` (full load) and fakes `pagination`
(`messageSlice.ts:242-293`). Backend `load_session_messages_paginated`
(chat-style: offset 0 = newest) exists for Claude but is unused by the unified
provider entry point.

## What "done" looks like

Opening a session issues a paginated request (newest window, ~200 messages).
Scrolling up loads earlier pages without a scroll jump. Export, session search,
and deep-link jumps still operate on the complete session. All quality gates
green.

## Scope

- **In:**
  - Backend: `load_provider_messages_paginated` (claude → existing paginated
    loader; other providers → load + merge + chat-style slice, bounding IPC and
    frontend memory) and `get_provider_message_offset` (uuid → offset-from-newest,
    powers deep links). Wire both in lib.rs AND WebUI server (routes +
    READ_ONLY_ALLOWED_API_PATHS + handlers — tauri-axum parity).
  - Frontend: messageSlice real pagination (initial page, loadMoreMessages
    prepend, in-place reload preserving window size, stale/concurrent guards);
    MessageViewer load-earlier UI + auto-load near top + scroll anchoring on
    prepend; counts show loaded-vs-total; navigateToMessage extends the window
    to cover an off-window uuid; export fetches full session at export time;
    session search builds its index from a one-shot full fetch on first search.
- **Out:**
  - True streaming pagination inside non-Claude provider parsers (still
    parse-then-slice server-side).
  - P2 stats caching, P3 project-list virtualization, P4 select-all semantics,
    P5 renderer size guards (separate tasks).

## Verified constraints (code-read 2026-07-12)

- Both Claude loaders (full + paginated) apply IDENTICAL filtering
  (`EXCLUDED_MESSAGE_TYPES` 6 types + `HIDDEN_SYSTEM_SUBTYPES`, load.rs:665-694)
  → no message-set change for Claude.
- Paginated loader supports `exclude_sidechain` at classification.
- Frontend `MessagePage` type exists unused (`message.types.ts:277`);
  `PaginationState` is `@deprecated` but is the live shape.
- Orphan i18n keys `messageViewer.loadMoreMessages` / `message.loadMore` exist
  in all 5 locales — reuse.
- `loadSubagents` progress back-compat scan is already dead for Claude (backend
  excludes `progress`); meta.json primary path unaffected by windowing.
- `flattenMessageTree` has an orphan fallback (<90% DFS → timestamp append) —
  a partial window renders; grouping degrades gracefully at boundaries.
- `useScrollNavigation.ts:338-354` auto-scrolls on length growth — prepend
  needs explicit anchoring.
- Consumers assuming full `messages`: export (`useExport` ← displayMessages),
  session search (searchSlice over in-memory array), `navigateToMessage`
  (findIndex → silent no-op), counts (AppLayout:643, FilterToolbar,
  `allMessagesLoaded` header), navigator outline, SessionLane count.

## Acceptance

- Open a large session → network/IPC request is `load_provider_messages_paginated`
  with limit ≤ default page size; store holds only the window.
- "Load earlier" (button + near-top auto-load) prepends without viewport jump.
- Global-search jump to an off-window message loads the containing window and
  scrolls to it.
- Export emits the complete session while only a window is loaded.
- Session search finds matches outside the loaded window.
- UI counts distinguish loaded vs total when `hasMore`.
- New Rust tests: chat-style slice helper + offset lookup + claude/non-claude
  paginated command behavior. Vitest: messageSlice pagination actions.
- Gates: `pnpm tsc --build .`, `pnpm vitest run`, `pnpm lint`,
  `pnpm run i18n:validate`, `cargo test -- --test-threads=1`, clippy, fmt.

## Risks / open questions

- RESOLVED: `merge_tool_execution_messages` is NOT a no-op for claude — it folds
  user `tool_result` blocks into the preceding assistant `tool_use` message.
  Decision: claude paginated path slices in PRE-merge index space (stable,
  matches `get_session_message_count`), then merges WITHIN the page. At a page
  boundary a tool_result whose assistant lives in an older page stays unmerged —
  it renders via the existing standalone tool_result renderers (accepted,
  boundary-only artifact). Non-claude: load → merge → slice in post-merge space
  (those providers fully parse today anyway). The 27-arm provider match is
  extracted into a shared helper so full + paginated entry points stay in sync.
- Scroll anchoring with @tanstack/react-virtual dynamic heights on prepend —
  verify with real run (WebUI --serve + playwright).
- Watcher-driven in-place reload must not shrink the user's loaded window.
