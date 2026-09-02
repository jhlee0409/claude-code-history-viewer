# Spec: uiux-pain-points

- Status: Implemented (5.3 provider merge deferred)
- Created: 2026-09-02

## Problem / goal
Original ask (verbatim):
1. "현재 UIUX audit 해주고 페인포인트 추출"
2. "우선순위별로 구체화 시작"

Audit evidence: live Tauri dev app (v1.27.0, 55 projects / 799 sessions) driven via Orca
computer-use + code scan. Pain points ranked P0→P2; this spec concretizes the top-6
remediation items in priority order.

## Priority list (from audit)
| # | Sev | Pain point |
|---|-----|-----------|
| 1 | P0 | Tool call content needs 3 clicks (row → Input → Result); collapsed row label is only the tool name |
| 2 | P0 | Message density: per-turn header repeated for every consecutive assistant block; `ID: toolu_…` eats 25% row width |
| 3 | P0 | Session list inlined inside project tree pushes other projects out; Global Stats deselects session |
| 4 | P0 | Settings save/delete failures swallowed (`console.error` only) |
| 5 | P1 | Project list polluted by OS temp-dir projects; same path duplicated per provider |
| 6 | P1 | Date filter label shows today-only while cards show all-time |
| 7 | P1 | Relative time / plural bugs (`0 minute ago`, `79 message`, `1 model(s)`) |

## What "done" looks like
Each item has a concrete change list (file:line), an observable acceptance check
runnable in the live app, and is implemented in priority order. Lower-priority
items are not started before higher ones are verified.

## Scope
- **In:** items 1–7 above; frontend only (React/TS/i18n); minimal Rust only if a
  data field is missing.
- **Out:** header icon consolidation (#7 in audit), global-search preview quality,
  responsive `max-w-[px]` sweep, focus-visible styling — tracked as follow-ups in
  context.md.

## Acceptance
- A1 Tool row: collapsed row shows a one-line summary of the input (e.g. bash → command
  text, read → path, edit → path). Expanding once shows both input and result without
  further clicks.
- A2 Density: consecutive assistant blocks in one turn share one header; tool ID
  hidden by default, copy via hover/menu. Same session (79 msgs) renders in noticeably
  less virtual height (baseline `size=38574px` from DEV overlay).
- A3 Sidebar: sessions render in a dedicated column beside the project tree; the
  project list never scrolls because a project was expanded. Clicking Global
  Statistics keeps the selected session in the sessions column.
- A4 Feedback: every `catch` in SettingsManager surfaces `toast.error`; forcing a
  save failure (read-only settings file) shows a toast.
- A5 Projects: projects under `$TMPDIR`/`/private/var/folders`/`/tmp` collapse into a
  "Temporary" group; same path across providers is one node with provider chips.
- A6 Filter: the date filter label matches the data range shown (all-time by default
  or filter actually applied).
- A7 Time: `just now`, `1 minute ago`, `2 minutes ago`, `79 messages` in en; other
  locales have plural keys.

## Risks / open questions
- A3 is a layout change in AppLayout.tsx (36KB) — highest regression risk; keep the
  inline mode behind the existing view-mode toggle if feasible.
- A5 merging providers changes `project.id` semantics used by selection state — verify
  with projectSlice.scanProjects tests.
