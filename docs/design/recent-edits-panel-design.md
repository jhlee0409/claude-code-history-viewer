# Recent Edits panel design

> Status: approved, ready to implement
> Date: 2026-08-21
> Spec: [`docs/specs/2026-08-21-recent-edits-panel.md`](../specs/2026-08-21-recent-edits-panel.md)
> Converged over three visual review rounds

## 1. Problem

`Recent Edits` renders every file as a card roughly 72px tall: an expand chevron, a 40px
operation badge, filename plus full absolute path on two lines, `+N` / `-N` buttons, a Diff
button, an operation pill, a timestamp chip, and three action buttons. About 8 rows fit on
screen out of 325 in a typical project.

It is also a value of the mutually exclusive `analytics.currentView` enum, which makes it a
sibling of the message viewer by construction, so it can never sit beside the conversation it
describes.

## 2. The row

Two lines, roughly 46px. Line 1 carries identity and magnitude; line 2 carries location.

```
> . HISTORY.md                                       +25 -6   14h
    skills/deliver-prd/                                  [reveal] [...]

> . TEMPLATE.md                                     +18 -12   14h
    skills/measure-instrumentation-spec/references/

> . skills-manifest.yaml                                +98    14h
    docs/internal/release-plans/v2.33.0/

^ ^ ^                                                ^        ^
| | filename (600 weight, ellipsis)                  |        relative time
| operation dot                                      line counts
expand chevron
```

### 2.1 Leading glyph alignment

The chevron and the operation dot align to **line 1**, not to the vertical centre of the row.

```css
.row-header { align-items: flex-start; }   /* not center */
.chevron    { margin-top: 3.5px; }         /* 12px glyph in a 19px line box */
.dot        { margin-top: 6px; }           /*  7px glyph in a 19px line box */
```

This needs a source comment, because it looks like an oversight. Plain `flex-start` aligns the
glyphs to the text ascender and they read visibly high; `align-items: center` centres them
across both lines, which was reviewed and rejected. The margins centre each glyph against the
filename's 19px line box.

### 2.2 Operation type is a dot, not a pill

Green created, blue edited, red missing on disk, each with a tooltip.

A text `Created` / `Edited` pill was tried and rejected: it costs about 55px, which at a 280px
rail width crushes the filename to roughly eight visible characters and pushes the directory off
the row entirely.

### 2.3 The directory line is load-bearing

Stripping it looks like an easy density win and is not. A real project routinely has several
files with the same name in different folders. In the sample used for review, the top six rows
contained two `TEMPLATE.md` and two `HISTORY.md`; without the directory those rows are
indistinguishable from one another.

Elision strips `project_cwd` and renders the remainder, so
`E:\Projects\product-on-purpose\pm-skills\skills\deliver-prd\references\TEMPLATE.md` becomes
`skills/deliver-prd/references/`. The full absolute path lives in the expanded view, which is
what makes aggressive elision safe.

Windows paths must split on `/[\\/]/` and compare the prefix case-insensitively, matching the
backend's own check at `edits.rs:465`.

### 2.4 Actions

Revealed on hover and while expanded, so the path has the full row width at rest.

A row whose file no longer exists on disk leads with **Restore** instead of **Reveal**, since
revealing a file that is not there does nothing. This is the `exists_on_disk` flag surfaced where
it is actionable.

### 2.5 Expansion

Row click expands. The expansion carries the existing `EditViewMode` chips
(`content` / `added` / `removed` / `diff`), the full absolute path, and a jump-to-message arrow.

The arrow is inside the expansion rather than bound to the row click, so the primary click does
nothing invisible and the expand target stays well above the 24px minimum. In per-edit grouping
a row maps to exactly one message; in per-file grouping a row represents several edits, so the
arrow targets the most recent and its tooltip says so.

## 3. Panel header

One row. The file count was dropped because the controls need the width.

```
+------------------------------------------------------------+
| [ Session | Project ]              [≡] [▤]              [...] |
+------------------------------------------------------------+
   scope, text                   density, icons      options
```

- **Scope** is text. No icon reads as "this session versus the whole project" without a label,
  and this is the control whose meaning matters most.
- **Density** is icon-only with `aria-label` plus tooltip: `AlignJustify` for compact, `Rows`
  for full cards. No density icon existed in the codebase; all 164 imported lucide icons were
  reviewed before choosing. `List` versus `LayoutList` was rejected as indistinguishable at 13px.
- **Options** is a `...` menu holding a **Group edits by** radio (`File (latest state)` /
  `Edit (chronological)`), a **Show** radio (`All files` / `Missing on disk only`), and
  `Undock to full page`.

All segmented controls reuse `src/components/ui/MetricModeToggle.tsx`: track `bg-muted/30
rounded-lg p-1 gap-1`, active `bg-card text-foreground shadow-sm`, inactive
`text-muted-foreground hover:text-foreground`, `aria-pressed` per button. An earlier review round
invented a filled-accent style that would have looked foreign next to the analytics dashboard.

Grouping and filters live in this menu rather than `SettingsManager`, which covers MCP servers,
presets and paths and has no appearance section. Grouping also changes what you are looking at,
so it should not require leaving the view to change.

## 4. Grouping

The same data, two reductions, toggled from the options menu.

```
PER FILE (default in project scope)      PER EDIT (default in session scope)
one row per file, latest state           one row per edit, chronological

. HISTORY.md        +25 -6   14h         . HISTORY.md       +3  -1   14:22
  skills/deliver-prd/                      skills/deliver-prd/
. SKILL.md          +1  -1   14h         . TEMPLATE.md     +17  -5   14:19
  skills/measure-instrumentation/          skills/deliver-prd/references/
. skills-manifest.yaml  +98  14h         . HISTORY.md      +12  -4   14:11
  docs/internal/release-plans/             skills/deliver-prd/
                                         . skills-manifest.yaml  +98  13:41
"what did this session touch, and         docs/internal/release-plans/
 where did each file end up"
                                         "walk me through what happened, in order"
```

Timestamp format follows grouping: relative for per-file, clock time for the stream. A
chronological list needs sequence more than recency, and `14h / 14h / 14h` down a stream conveys
nothing.

Note `HISTORY.md` appearing three times on the right, collapsed to a single `+25 -6` on the left.
The stream is the view that pairs with jump-to-message, because each stream row maps to exactly
one message.

## 5. Container

Recent Edits does not get a bespoke rail. It registers into a `PanelDock`:

```ts
groups: Array<{ tabs: PanelId[]; activeTab: PanelId; size: number }>
```

**It ships with one group holding one tab, and the dock renders no chrome of its own.** With a
single registered panel there is no tab strip, so the docked panel is visually identical to a
purpose-built rail: one `useResizablePanel`, one persisted open state, one `aside`, one skip link.

The array shape is the point. A second panel later means a tab strip appears when
`tabs.length > 1`; a split later means a second array element. Shipping a single hard-coded panel
instead would make the second panel a refactor and a third a rewrite.

```
NOW                              LATER (second panel registers)
+---------------------------+    +---------------------------+
| [Session|Project] [≡][▤] .|    | [Edits] [Files]         x |
+---------------------------+    +---------------------------+
| > . HISTORY.md   +25 -6   |    | [Session|Project] [≡][▤] .|
|     skills/deliver-prd/   |    +---------------------------+
| > . SKILL.md      +1 -1   |    | > . HISTORY.md   +25 -6   |
+---------------------------+    +---------------------------+
no tab strip                     one strip added, row untouched
```

Width is resizable, default 340px rather than the navigator's 280px, min 260, max 520. Verified
at 280px: the path elides from the left while filename and counts hold.

## 6. Locked values

| Decision | Value |
|---|---|
| Row | two lines, ~46px. line 1 name plus counts plus time right aligned; line 2 path plus hover actions |
| Leading glyph alignment | `align-items: flex-start`, chevron `margin-top: 3.5px`, dot `margin-top: 6px` |
| Operation type | colored dot with tooltip. green created, blue edited, red missing. never a text pill |
| Path | strip `project_cwd`, render remainder on line 2. full path in the expansion |
| Actions | on hover and while expanded. missing-on-disk leads with Restore |
| Row click | whole row expands. jump-to-message arrow inside the expansion |
| Width | resizable, default 340, min 260, max 520 |
| Density default | compact when docked, standard on the full page, persisted separately |
| Header | one row: text scope toggle, icon density toggle, options menu. no file count |
| Control style | reuse `src/components/ui/MetricModeToggle.tsx` |
| Density icons | `AlignJustify` compact, `Rows` full |
| Grouping and filters | options menu via `DropdownMenuRadioGroup`, not app settings |
| Timestamps | relative per-file, clock time per-edit |
| Container | `PanelDock`, groups array, one group and no tab strip at launch |

## 7. Rejected, and why

Recorded so these are not reinvented later.

| Rejected | Reason |
|---|---|
| Filename-only rows | duplicate filenames in different folders become indistinguishable |
| Text `Created` / `Edited` pill | ~55px, crushes the filename to eight characters at 280px |
| Single-line compact row | cannot fit filename, path, counts, time and actions at any usable width |
| Actions pinned rather than on hover | steals ~48px from the path on every row |
| `align-items: center` on the row header | glyphs float between the lines instead of anchoring to the filename |
| Filtering session scope by `session_id` | `actual_session_id` is only the first id in a file, so a resumed session drops edits |
| Grouping toggle in `SettingsManager` | that surface is Claude configuration and has no appearance section |
| Per-field show/hide customization of the row | density presets plus the overflow menu cover it without persisted per-field state |
| Three independent side-by-side rails | 1176px of chrome leaves a 1440px window 264px of transcript |
