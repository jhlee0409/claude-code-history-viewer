# Context: uiux-pain-points

## 0. Resume here
All 7 planned items implemented and verified in the live Tauri dev app (Orca screenshots)
plus `pnpm lint` (0 errors), `tsc --noEmit`, `pnpm vitest run` (104 files / 1194 tests),
`pnpm i18n:validate`, `pnpm generate:i18n-types`. Nothing is committed yet.

Deferred: plan task 5.3 (merge same `actual_path` across providers into one node with
provider chips). Requires selection identity to carry `(path, provider)`; see
`projectSlice.ts:154-159 isSameProject`.

## Findings surfaced while implementing (not in original audit)
- oh-my-pi user messages render twice: a bubble plus a plain text block directly below
  (seen in session `01a061a0`, "글로벌인데 레포에 코드를 남길 이유가 있어?"). Likely a
  duplicate `text` block in the parsed content or a user-message fallthrough in
  `ClaudeContentArrayRenderer`. P1.
- KPI cards on Analytics/Global overflow at < ~1000px content width (`5525.` clipped,
  `13 days 16 hours 49 minut`). Number font needs `clamp()`/wrap or the duration card
  needs a compact format. P2.
- Settings Manager two-column layout collapses below ~900px (heading `Manager` cut off).
  P2 — the sessions column is now hidden on that view, but the underlying min-width issue
  stays.
- `useToggle("renderer")` fallback key: nested `Renderer`s without `expandKey` inside one
  message share `${uuid}:renderer`, so toggling one toggles all siblings. Pre-existing;
  worth giving each nested result an explicit key.

## Decisions
- Continuation grouping is computed in `flattenMessageTree` (`isContinuation`) rather than
  in the renderer so the virtualizer's height estimate and capture mode see the same rows.
- Tool-name aliasing only covers names whose input shape matches the target card; oh-my-pi
  `edit` (hashline `input`) deliberately stays on `DefaultCard`.
- Sessions pane is gated: `lg`+, desktop, a project selected, not Settings/Archive.
- `saveSettings` keeps no toast: both callers already render the failure inline.
- Plural keys migrated to i18next v4 `_one/_other`; dead `common.update.deadline*` and
  `message.loadMore*` removed.

## Theme pass (follow-up to audit, 2026-09-02)
- Hard-coded palette classes 708 → provider/agent identity palettes only (`utils/providers.ts`, `utils/agentStyles.ts`, both dark-paired).
- Tokenized: MessageViewer toolbar, capture-mode UI, SettingsManager dialogs/sidebar/editor, SessionBoard, SmartJsonDisplay (hue kept, dark pairs), GlobalSearch, HighlightedText → `--highlight*`, GroupHeader variants → info/success/warning/neutral, RecentEdits chips → success/destructive.
- `scrollbar.css` now driven by `--scrollbar-*` = border/muted-foreground/accent.
- `.high-contrast` / `.dark.high-contrast` now override success/warning/info, all `--tool-*`, sidebar, highlight tokens.
- Session titles: dropped `italic opacity-70` on auto-titled rows (kept bold for renamed).
- Verified live in light, light+HC, dark. Known remaining: `text-warning-foreground` on `bg-warning` in dark is low contrast (token-level, pre-existing in button.tsx warning variant).

## Round 3 (2026-09-02, after commit split)
Done: user-text duplication (eaaa878), global search quality (c05fb77), header consolidation (90ee4ec).
Remaining from backlog: KPI card overflow <1000px; Settings Manager <900px layout; `max-w-[px]` sweep;
nested Renderer shared expand key `${uuid}:renderer`; provider merge (plan 5.3).

## Round 4
Done: KPI/Settings/header reflow (85ee6fc), typecheck fix + SessionCopyMenu regression (8ad5a2a),
per-entry expand keys (81a27a6). NOTE: use `pnpm typecheck` (tsc -b); root `tsc --noEmit` is a no-op.
Remaining: provider merge (plan 5.3); `--muted-foreground` light contrast measurement; text-warning-foreground on bg-warning (dark).

## Round 5
Done: dark status-foreground contrast + settings container fix (e6f10e9), provider merge in flat list (plan 5.3).
Backlog is empty apart from the light `--muted-foreground` check, which measured 7.1:1 (no change needed).
