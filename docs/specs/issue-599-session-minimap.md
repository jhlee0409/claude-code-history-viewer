# Session minimap: strip, viewport box, click and drag, settings switch

> Status: PR 1 merged as #634 (`508812cb`) on 2026-10-10 and shipped in v1.32.0. PR 2 is
> specified in the "PR 2" section at the end, added 2026-10-12.
> Date: 2026-10-04, decisions applied 2026-10-05
> Verified: every line number above the "PR 2" section was checked against `develop` at
> `e1789a79` (after #629, the prompt-jump shortcut, and #630, its follow-up fixes). The PR 2
> section cites `develop` at `e2175dc2`.
> Scope: PR 1 (strip, viewport box, click and drag, settings switch, keyboard shortcut) in the
> sections up to "Open questions". PR 2 (search ticks, not-loaded band, hover previews) in the
> "PR 2" section at the end.
> Visual reference: https://jprisant.github.io/claude-code-history-viewer/minimap/

## Background

Issue #599 asked three questions about a VS Code-style minimap beside the message list. The
maintainer's answers are fixed inputs to this spec, not open questions:

1. "Welcome: yes."
2. "Default: off."
3. "Where the switch lives: the settings (gear) menu as a switch row, plus a keyboard shortcut,
   persisted like the Messages panel state. We moved most header icon buttons into the app menu
   recently, so we'd rather not add a new toolbar button."

The maintainer also wrote: "Your two-PR plan works (strip + viewport box + click/drag + switch +
shortcut first; search ticks, not-loaded band and hover previews second). Since the colors reuse
the row kinds from #600, building on current develop is fine. Please keep it frontend-only and
hidden in Capture Mode / below md, as described."

"#600" is the Messages panel effort that added the `classifyMessage` row-kind classifier this
spec reuses. On 2026-09-30 the maintainer raised a possible future direction: "a commenter on
#570 asked for a per-turn token-cost view, which could become a second coloring mode on this same
strip." This spec treats that as a future extension. It keeps the color source pluggable for it
but does not design it.

PR #629 (prompt-jump shortcut) merged into `develop` on 2026-10-05 as `7e52c341`, so its
Alt+ArrowUp/Alt+ArrowDown shortcut now exists as a second keyboard-equivalent control for the
strip's hidden content; the citations below were read directly from `develop`, not from the
pre-merge PR. The Accessibility section's justification for `aria-hidden="true"` rests on the
Messages panel alone and never depended on #629.

## Goals

1. A narrow strip beside the message list shows the whole loaded session as colored blocks, one
   block per row, sized by the row's current measured-or-estimated pixel height.
2. A translucent box on the strip marks the part of the session currently in view.
3. Clicking the strip jumps the list to that point. Dragging the box scrolls the list
   continuously.
4. A switch in the settings menu turns the strip on or off, off by default, persisted across
   restarts.
5. A keyboard shortcut toggles the same state.
6. The strip never appears in Capture Mode or on a narrow window, and it is frontend-only.

## Non-goals (YAGNI)

- Search-match ticks on the strip. Second PR.
- The hatched "not loaded" band for pages not yet fetched. Second PR.
- Hover previews of the row under the pointer. Second PR.
- A token-cost coloring mode. Possible future extension; this spec only keeps the color source
  pluggable for it.
- A toolbar button for the switch. The maintainer rejected a new toolbar button explicitly.
- Any new Tauri command or Axum route.
- Keyboard operation of the strip itself; see Accessibility.

## Verified constraints (code-read 2026-10-05, from origin/develop at `e1789a79`)

Line numbers below are current as of `e1789a79`. Every bullet describes code already on
`origin/develop` at that commit, including the `usePromptJump` bullet below, which PR #629
(prompt-jump shortcut) added and which merged as `7e52c341` before PR #630's follow-up fixes.
- `classifyMessage(message): MessageKindInfo`, `messageKinds.ts:198`. `MessageKind` has eight
  values (`prompt`, `command`, `agent-update`, `context`, `reply`, `tool`, `system`, `summary`),
  `messageKinds.ts:10-24`. `isFailedTaskStatus(status)` at `messageKinds.ts:77-78`.
- `useVirtualizer` (`hooks/useMessageVirtualization.ts:159-175`) returns the `Virtualizer`
  instance from `@tanstack/virtual-core` directly, re-exported by `@tanstack/react-virtual`
  (`react-virtual@3.14.10/dist/esm/index.d.ts:2`). That class declares
  `measurementsCache: Array<VirtualItem>` with no `private` modifier, so it is public
  (`virtual-core@3.17.8/dist/esm/index.d.ts:91,98`), each item exposing `start` and `size`
  (`index.d.ts:23-30`). `package.json:36` pins `@tanstack/react-virtual@^3.14.10`. Its resolved
  `@tanstack/virtual-core` dependency in `node_modules` is `3.17.8`, re-checked against the
  installed package directly, not just the lockfile string. The hook returns `virtualizer`,
  `flattenedMessages`, and `totalSize` together (`useMessageVirtualization.ts:217-227`).
- Rows are filtered before the virtualizer sees them: `MessageViewer.tsx` computes
  `displayMessages = applyMessageDisplayFilter(messages, messageFilter)`
  (`MessageViewer.tsx:177-179`, `helpers/messageDisplayFilter.ts:14-16`) and passes
  `messages: displayMessages` into `useMessageVirtualization` (`MessageViewer.tsx:393-394`). The
  strip draws exactly what the reader sees, with no filtering of its own.
- `FlattenedMessage` unions `FlattenedMessageItem` (`"message"`), `DateDividerItem`
  (`"date-divider"`), and `HiddenBlocksPlaceholder` (`"hidden-placeholder"`),
  `components/MessageViewer/types.ts:159`. Only `"message"` rows have a kind.
  `hiddenMessageIds` persists across a Capture Mode exit: `exitCaptureMode` clears selection
  state but not this list (`captureModeSlice.ts:18-19,101-108`). A `hidden-placeholder` row can
  therefore reach `flattenedMessages` while the strip is visible. Design §4 already paints these
  rows as nothing; that is where the safety comes from, not from Capture Mode exclusivity. Agent
  task group members measure at height 0 with `aria-hidden="true"`
  (`useMessageVirtualization.ts:168-173`), so a group collapses to its leader in
  `measurementsCache`.
- `FloatingDateOverlay` mounts as a sibling of the scroll container inside a
  `relative flex-1 min-h-0` wrapper (`MessageViewer.tsx:1075-1082`), taking `virtualRows` and
  `flattenedMessages` as props, nothing from the store
  (`components/MessageViewer/components/FloatingDateOverlay.tsx:18-21,52-53`). The strip mounts
  the same way, as a second sibling.
- Scroll element: `scrollContainerRef.current?.osInstance()?.elements().viewport`
  (`MessageViewer.tsx:329-330`), exposed as `getScrollElement`. `OverlayScrollbarsComponent` uses
  `autoHide: "leave"` (`MessageViewer.tsx:1084-1090`); its scrollbar hides itself on its own
  track at the right edge.
- A deep-link effect drives `virtualizer.scrollToIndex` in three staggered passes (50/200/450ms)
  to correct height-estimate drift (`MessageViewer.tsx:722-741`). That path is for one jump, not
  a continuous drag; the drag handler must set `scrollTop` directly instead.
- A global, virtualizer-aware keyboard precedent exists: `usePromptJump` binds
  `window.addEventListener("keydown", ...)` and reads `flattenedMessages`, `virtualizer`, and
  `getScrollElement` (`src/components/MessageViewer/hooks/usePromptJump.ts:51-96`),
  implementing Alt+ArrowUp/Down, "jump to previous or next prompt." (Added by PR #629,
  prompt-jump shortcut, now on `develop`.) PR #630 then made it ignore keys whose target is
  inside `[role='dialog']` or `[role='alertdialog']`.
- `useAppKeyboard.ts` binds Cmd/Ctrl+K (search) and Cmd/Ctrl+Shift+M, which toggles the Messages
  panel except when `isMobile` is true (`useAppKeyboard.ts:17-30`). Two other `keydown` listeners
  in `src/` read `altKey`, and both use it only as an exclusion guard, not a new Alt chord:
  `ProjectTree/index.tsx:679-681` (typeahead exclusion) and `MessageNavigator.tsx:156`
  (`event.altKey` bails out of its own handler). PR #630 added a third guard of the same kind,
  `getTreeNavigationKey` in `ProjectTree/treeKeyboard.ts`, which leaves Alt+Arrow to the prompt
  jump. No listener binds a new Alt combo. Alt+ArrowUp/Down (added by PR #629, prompt-jump
  shortcut) and Cmd/Ctrl+Shift+M are both taken.
- `useMediaQuery.ts` exports `useIsLgUp()` (1024px) and `useIsXlUp()` (1280px) from a shared
  `useMediaQuery(query)` (`useMediaQuery.ts:11-47`), no `md` (768px) export yet. Its docstring
  says a component should gate its *mount* on the breakpoint CSS gates its *display* on, so an
  effect does not run for a panel nobody can see (`useMediaQuery.ts:6-9`). No `screens` override
  in `tailwind.config.js`, so `md` is Tailwind's default 768px. `useIsMobile()`
  (`src/hooks/useIsMobile.ts:3-6`) already queries the inverse breakpoint, `max-width: 767px`.
  `useIsMdUp()` can be `!useIsMobile()` rather than a new query; Build order step 3 shrinks to a
  one-line wrapper. The Messages panel hides below `md` with CSS alone (`AppLayout.tsx:818-824`);
  the strip should not copy this, see Decisions.
- `isCaptureMode` is a plain store boolean (`captureModeSlice.ts:17,64`,
  `store/slices/types.ts:160`, read at `MessageViewer.tsx:144`).
- Per-kind styling for the Messages panel is a `Record<MessageKind, KindStyle>` of Tailwind color
  classes, not raw colors (`NavigatorEntry.tsx:38-47`), resolving to CSS custom properties in
  `index.css:116-134` (light), `:242-257` (dark), `:363-378,400-414` (high-contrast). These eight
  rows use only five distinct `iconClass` values: `prompt` and `command` both resolve to
  `text-info` (`NavigatorEntry.tsx:39-40`); `context`, `tool`, and `system` all resolve to
  `text-muted-foreground` (`NavigatorEntry.tsx:42,44-45`). A strip that paints these classes
  verbatim gives rank 1 and rank 2 the same color, and ranks 6 through 8 the same color, with no
  icon to disambiguate them the way `NavigatorEntry` does; see Design §5 for how this spec
  handles that. The custom properties are re-exposed as Tailwind tokens at `index.css:460-489`
  (for example `--color-info: var(--info)`). Commit `1bd82f8b` moved these off hardcoded values,
  which is why the strip must read colors at draw time.
- `SearchMatch` (`messageUuid`, `messageIndex`, `matchIndex`) and `SearchState.matches`
  (`store/slices/types.ts:38-41,49-51`); `MESSAGE_PAGE_SIZE = 200` and per-page `total_count`
  (`store/slices/messageSlice.ts:117,310,321`). Both are PR 2 data sources, unused in PR 1.
- The settings-menu switch pattern exists twice in `FilterMenuGroup.tsx`: a `DropdownMenuItem`
  with `role="menuitemcheckbox"`, `aria-checked`, and a decorative `Switch` with
  `aria-hidden="true"` and `tabIndex={-1}`
  (`src/layouts/Header/SettingDropdown/FilterMenuGroup.tsx:25-44,46-64`).
  `SettingDropdown/index.tsx` composes five menu groups as siblings (`:93-112`), each after a
  `DropdownMenuSeparator`. Rechecked 2026-10-05: only two groups carry a `DropdownMenuLabel`
  heading, `FilterMenuGroup.tsx:22-24` ("Filter") and `AccessibilityMenuGroup.tsx:16-18`
  ("Accessibility"). Font, Theme, and Language are `DropdownMenuSub` submenus. No display or view
  heading exists to reuse.
- The persisted-boolean pattern exists in `navigatorSlice.ts` (`isNavigatorOpen`, key
  `"navigator-open"`, every `localStorage` call wrapped in `try`/`catch`,
  `navigatorSlice.ts:16,25-28,35,40`). `isNavigatorOpen` defaults to `true` when nothing is
  stored (`navigatorSlice.ts:24-27`). A slice registers in `useAppStore.ts` in three places: the
  import (`:57-60`), the type intersection (`:109`), and the spread (`:134`).
- `common.settings.filter.title/.showSystemMessages/.showSubagentMessages`,
  `common.json:119-121`. `navigator.kind.*` (one per `MessageKind`), `message.json:81-88`. These
  two are on `develop`. `navigator.promptJumpHint`, a precedent for a shortcut-hint string,
  arrived with PR #629 (prompt-jump shortcut) and is now on `develop`, translated in all five
  locales.

## Design

### 1. Data source

The strip draws from values `MessageViewer.tsx` already holds: `virtualizer` (for
`measurementsCache` and `getTotalSize()`), `flattenedMessages`, and `getScrollElement`. No new
data, no new fetch. Because `displayMessages` is already filtered before it reaches the
virtualizer, the strip's row count always matches what a scrolling reader sees.

`SessionMinimap` first derives a parallel kind array from `flattenedMessages`, one entry per row,
using `classifyMessage` (`messageKinds.ts:198`). This array is memoized and recomputed only when
`flattenedMessages` changes, not on every redraw; see Performance budget for why that matters. A
pure layout helper, `src/components/MessageViewer/helpers/minimapLayout.ts`, takes
`measurementsCache`, that kind array, and a strip height in pixels, and returns pixel buckets:
one winning paint per output pixel row. It touches no DOM and no canvas, so it is unit-testable
without jsdom's canvas gap.

### 2. Mount point

The strip mounts as a second sibling inside the wrapper that already holds `FloatingDateOverlay`
(`MessageViewer.tsx:1075-1082`), taking all its inputs as props. The mount site decides
visibility with one hook, `useMinimapVisible()` (the switch, Capture Mode, and the `md`
breakpoint together). It combines that with the list's own render guard (rows to show and a ready
scroll element) into one condition, `showMinimapStrip`, which the strip, the padding, and the
scroll buttons' offset all read, so mounting and padding can never disagree. The wrapper adds right padding
equal to the strip's width (64px, the prototype's Blocks width) so the list's content never sits
under it. The width is fixed; it does not scale with window width. The floating scroll-to-top and
scroll-to-bottom buttons sit at the same wrapper's right edge, so they move left by the strip's
width while it is shown. The padding also moves OverlayScrollbars' host, so its
auto-hiding scrollbar shows at the list's own right edge, just left of the strip, with no
restyling (verified in the browser; see Risks).

### 3. Drawing

A single `<canvas>`, not one DOM node per row, since a long session holds thousands of rows,
most thinner than one pixel. Per redraw: read `measurementsCache` (after `getTotalSize()`, which
refreshes it); compute `scale = stripHeightPx / contentHeight`, where `contentHeight` is the scroll
element's `scrollHeight`. Measurements start after the list header (the virtualizer's
`scrollMargin`), but `getTotalSize()` leaves that margin out, so only the scroll content's own
height puts the blocks, the viewport box, and clicks on one scale. Each `start` is also shifted by
the list's measured offset below `scrollMargin`, for anything else rendered above the list inside
the scroll container (the dev-only debug panel, the "no search results" notice). For each
measurement, `y0 = floor(start * scale)`,
`y1 = ceil((start + size) * scale)`, forcing `y1 >= y0 + 2` for `prompt` rows so a one-line
prompt never disappears; walk a `winner: Paint | null` array sized to the strip's pixel height,
keeping the existing winner unless a new row's priority is higher (§4); paint each winning pixel
row as a bar that starts 5px from the strip's left edge and is `max(3, barW * weight)` wide.
`barW` is the strip width less 5px on each side and a 7px right gutter kept free for PR 2's
search ticks. The weights are the prototype's `PAINT` widths (prompt 1, summary 0.9, agent update
0.8, reply and command 0.7, tool 0.5, context and system 0.4). The prototype paints replies and
tool calls in dim colors, so the painter lowers `globalAlpha` for them: reply 0.55, tool 0.3,
context and system 0.25. Prompts, commands, agent updates, and summaries paint at full strength.
The strip has its own background (`bg-muted/40`) and a 1px left border, as the prototype's does.

Canvas backing size is `round(cssSize * devicePixelRatio)`, with
`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` before drawing, as the prototype's `draw()` does.
Redraws are throttled to one per animation frame: a pending flag is set, and a single
`requestAnimationFrame` callback clears it and draws, the same coalescing the prototype's scroll
listener uses. Triggers: an effect keyed on `totalSize` and `virtualRows`, the same values
already passed into `FloatingDateOverlay` as props; a `ResizeObserver` on the strip; and the
class-change signal from Design §5. The virtualizer's own `onChange` is not used as a trigger: it
is a one-time constructor option on `VirtualizerOptions`, set only when
`useMessageVirtualization.ts:159-175` first calls `useVirtualizer`, not a subscription a sibling
component can attach to afterward.

### 4. Priority rule

When several rows land in one output pixel, the highest-priority kind wins. This order adapts
the prototype's `PAINT` table onto the real eight `MessageKind` values,
matching the maintainer's framing: "prompt beats agent activity beats replies."

| Rank | Kind | Why |
|---|---|---|
| 1 | `prompt` | The reader's own words; top rank in the prototype too. |
| 2 | `command` | A deliberate user action, same tier as a prompt. |
| 3 | `agent-update` | Sparse, high-signal background completions and failures. A failed update additionally paints with the destructive color token; rank is unchanged. |
| 4 | `summary` | Rare; marks a compaction or session boundary, like the prototype's "away"/"compaction" tier. |
| 5 | `reply` | Claude's own text, the bulk of an ordinary turn. |
| 6 | `tool` | Voluminous, already visually distinct in the list itself. |
| 7 | `context` | Injected wrapper text, not typed by anyone; the prototype's lowest tier. |
| 8 | `system` | Hidden by default, so it rarely reaches the strip at all. |

`date-divider` and `hidden-placeholder` rows have no kind. They paint nothing and leave the
background showing, rather than claiming a pixel a real row could use.

The failed-update override in the table above is a draw-loop decision, not a color-source one.
The draw loop calls `colorForKind(kind)` for the base color, then checks that row's own
`isFailedTaskStatus` (`messageKinds.ts:77-78`) and overrides with the destructive token if it is
true. `MinimapColorSource.colorForKind` takes only a `kind`, with no status argument, and does
not need one for this.

### 5. Colors

Colors come from the same CSS custom properties `NavigatorEntry.tsx:38-47` keys off of, read
through `getComputedStyle` at draw time, not a static table. `index.css` defines different
values for light, dark, and two high-contrast variants
(`index.css:116-134,242-257,363-378,400-414`), and commit `1bd82f8b` moved exactly this kind of
color off hardcoded values, so a cached copy would go stale on a theme switch. The strip reads
each kind's base token (for example `--info`), not the Tailwind re-export (`--color-info`,
`index.css:460-489`). Research during this revision confirmed `getComputedStyle` already
resolves a custom property's own `var()` references, so either token works; the base one is one
less indirection to double-check later.

Two independent signals decide which variant is active, not one "theme-change signal."
`ThemeProvider` toggles `.dark` on `document.documentElement` (`ThemeProvider.tsx:59-66`). A
separate effect toggles `.high-contrast` from the store's `highContrast` field
(`useAppInitialization.ts:69-72`, `settingsSlice.ts:26`). The strip watches both at once with a
single `MutationObserver` on `document.documentElement`'s `class` attribute, redrawing on any
change, instead of subscribing to either source directly.

Five of the eight kinds share a color under this scheme, as the Verified Constraints note above:
`prompt` and `command` both paint `text-info`; `context`, `tool`, and `system` all paint
`text-muted-foreground`. This spec accepts that collapse rather than adding four new theme
tokens across four variants. Design §3's bar width and Design §4's priority rule still separate
same-color neighbors on the strip: a `command` row still outranks a `reply` row for a shared
pixel, even though `command` and `prompt` paint the same color. Acceptance #4's priority win is
visible as a color change only when the two kinds in contention use different tokens; a reviewer
checking that criterion should pick a `prompt`-versus-`reply` or `command`-versus-`tool` pair,
not `prompt`-versus-`command`. If the PR's screenshots show this five-color strip as noisy, the
fallback is to color only the key kinds (`prompt`, `command`, failed `agent-update`) and paint the
rest in one neutral token; that fallback still needs no new theme tokens.

Whether `ctx.fillStyle` accepts an `oklch()` string is a real question, not a style choice.
`index.css`'s tokens are already `oklch()` values (`index.css:116-134`); that is a fact about
this app's existing palette, not something the strip introduces. Canvas color parsing and CSS
color parsing share one parser per the HTML canvas specification. An engine that accepts
`oklch()` in CSS should accept it in `fillStyle` too; this is an inference from the spec's
design, not a measurement taken per engine. By caniuse, that floor is Chromium 111, Firefox 113,
and WebKit 15.4. The real risk is not the browser serving `--serve`; it is this app's own
declared minimum. `tauri.conf.json:61` sets `minimumSystemVersion: "10.13"` for macOS, several
major releases before Safari 15.4 shipped. A reader on an old enough Mac could be running a
WKWebView that does not parse `oklch()` at all. Per the HTML canvas specification, assigning
`fillStyle` a color string it cannot parse is a silent no-op: the attribute keeps its previous
value, the canvas default black, instead of throwing. On such a machine every block on the strip
would paint black, not fail loudly or disappear.

The minimap builds no fallback of its own for this. The whole theme already depends on
`oklch()`: `src/index.css` has 311 lines containing it (329 occurrences, counted 2026-10-05). A
WebKit that cannot parse `oklch()` therefore breaks the entire app's colors, not only the strip,
and a minimap-only sRGB table would fix one surface of a theme-wide problem while adding a second
color table to keep in sync by hand. Instead, the minimap PR's notes carry one optional line for
the maintainer: the theme uses `oklch()` throughout while `tauri.conf.json:61` declares macOS
`10.13`, and a Mac whose system WebKit predates Safari 15.4 cannot parse `oklch()`. Whether to
raise the declared minimum or add a theme-wide fallback is the maintainer's call, outside this
PR.

A small named interface lets a second mode plug in later without touching the drawing code:

```ts
export interface MinimapColorSource {
  /** CSS color for this row's kind, or null to leave the pixel unpainted. */
  colorForKind(kind: MessageKind): string | null;
  /** Priority for this row; higher wins a pixel shared with a lower one. */
  priorityForKind(kind: MessageKind): number;
}
```

PR 1 ships one implementation, `kindColorSource`, built from `classifyMessage` and the §4 table.
The maintainer's token-cost idea (issue #570) is a plausible second implementation, keyed on each
message's existing `costUSD` field (documented in this repo's `CLAUDE.md`) instead of kind. This
spec keeps the seam open; it does not design that mode.

### 6. Viewport box and interaction

An absolutely positioned `<div>` over the canvas, not drawn on it, so a CSS transition on `top`
needs no redraw. Like the prototype's `.vp`, it has a 12 percent foreground fill and 1px top and
bottom edges at 30 percent; without the edges it is nearly invisible in the light theme.
Position: `top = scrollTop * scale`, `height = max(6, clientHeight * scale)`, read on
every `scroll` event, as the prototype's `updateViewport()` does. **Click** centers the list on
the clicked point, `scrollTop = clickY / scale - clientHeight / 2`, as the prototype's
`scrubTo()` does. **Drag**: `pointerdown` calls `setPointerCapture`, then every `pointermove`
sets `scrollTop` directly, no debounce, as the prototype's `pointerdown`/`pointermove`/
`pointerup` handlers do; this bypasses `navigateToMessage` and the three-pass `scrollToIndex`
correction (`MessageViewer.tsx:722-741`) on purpose, since re-running that during a drag would
fight it. The strip exposes no keyboard role; see Accessibility.

### 7. Switch and keyboard shortcut

A new menu group, `src/layouts/Header/SettingDropdown/ViewMenuGroup.tsx`, with its own
`DropdownMenuLabel` heading, "View", and one `DropdownMenuItem` that copies "Show system
messages" exactly (`FilterMenuGroup.tsx:25-44`). `SettingDropdown/index.tsx` places it directly
after `FilterMenuGroup`, behind its own `DropdownMenuSeparator`, the way the other groups are
composed (`:93-112`). The switch does not go under "Filter", because a minimap is not a filter
and that heading would mislead. No existing display heading can host it instead (Verified
constraints). See Decisions.

State lives in a new slice, `src/store/slices/minimapSlice.ts`, copying `navigatorSlice.ts`'s
structure: its interface shape and its try/catch `localStorage` pattern
(`navigatorSlice.ts:16,25-28,35,40`), not its stored default. `isNavigatorOpen` defaults to
`true` when nothing is stored (`navigatorSlice.ts:24-27`). `isMinimapOpen` must default to
`false` per Goals #4 and the State section below, so this is a structural copy with the default
flipped, not a field-for-field copy. Registered in `useAppStore.ts` the same way
`NavigatorSlice` is (`:57-60,109,134`).

### 8. Hidden surfaces and scope

- **Capture Mode.** Rendered only when `!isCaptureMode` (`captureModeSlice.ts:17,64`).
- **Narrow windows.** A new `useIsMdUp()` in `useMediaQuery.ts`, implemented as
  `!useIsMobile()` (`src/hooks/useIsMobile.ts:3-6`) rather than a new query, since the two
  breakpoints are already inverses; rendered only when true. See Decisions for why this is a
  mount gate, not CSS-only hiding like `AppLayout.tsx:818-824`.
- **Screen readers.** The strip's root carries `aria-hidden="true"`.
- **Frontend-only.** Every input is already in the frontend: no new Tauri command, no new Axum
  route, no change to `src-tauri/`. The WebUI served by `--serve` gets the feature automatically.

### PR 2: search ticks, not-loaded band, hover previews

Specified in full in the "PR 2" section at the end of this document.

## State

```ts
// src/store/slices/minimapSlice.ts
export interface MinimapSliceState {
  isMinimapOpen: boolean; // default false, key "minimap-open"
}
export interface MinimapSliceActions {
  toggleMinimap: () => void;
  setMinimapOpen: (open: boolean) => void;
}
```

No session-scoped or project-scoped state. The flag is global, matching `isNavigatorOpen` today.

## i18n

New keys in `src/i18n/locales/*/common.json` for all five locales (en, ko, ja, zh-CN, zh-TW),
with real translations as PR #629 did, in a new `common.settings.view.*` group beside
`common.settings.filter.*` (`common.json:119-121`). English text:

```
common.settings.view.title               "View"
common.settings.view.showMinimap         "Show session minimap"
common.settings.view.minimapShortcutHint "{{keys}} toggles the minimap"
```

`minimapShortcutHint` follows the precedent of `navigator.promptJumpHint` (PR #629, now on
`develop`), which interpolates a `{{keys}}` label built per platform by
`getPromptJumpKeysLabel()` in `src/components/MessageViewer/helpers/promptJump.ts`. Build the
minimap's own `{{keys}}` label the same way, from `isMacOS()` (`src/utils/platform.ts`). After
adding keys: `pnpm run generate:i18n-types`, then `pnpm run i18n:validate`. PR 2 reuses `navigator.kind.*` (`message.json:81-88`) for hover-preview
labels; no new kind-label keys are needed.

## Accessibility

- The strip's root is `aria-hidden="true"`: a pointer-only convenience. The Messages panel
  already covers the same jumps for keyboard users. PR #629 (prompt-jump shortcut, merged
  2026-10-05) adds a second, finer-grained control, Alt+ArrowUp/Alt+ArrowDown
  (`src/components/MessageViewer/hooks/usePromptJump.ts`).
- The settings-menu switch is keyboard-operable like "Show system messages": a real
  `DropdownMenuItem` with `role="menuitemcheckbox"`; its visual `Switch` is decorative and never
  receives focus.
- The keyboard shortcut toggles the persisted state whether or not the strip is visible. This
  deliberately diverges from Cmd/Ctrl+Shift+M, which `useAppKeyboard.ts:28` skips outright when
  `isMobile` is true. The divergence is safe here: the strip's own mount gate (Design §8,
  `useIsMdUp()`), not the keyboard handler, controls whether toggling the flag has any visible
  effect. Flipping an unused boolean below `md` costs nothing. Acceptance #10's "from anywhere"
  reflects this choice; it is not an oversight.

## Performance budget

Per redraw, the layout helper visits every entry in `measurementsCache` once: O(n) in the number
of loaded rows, gated to at most once per animation frame. Design §1's memoized kind array keeps
this a pass over two flat arrays, measurements and kinds, not a classify-and-regex pass. Without
that memoization, `classifyMessage` (`messageKinds.ts:198`) would run on every row on every
redraw, since it parses text and runs a regex internally (`isTaskNotification`,
`messageKinds.ts:82`). `useNavigatorEntries.ts:62-76` already shows the same memoization
pattern, over raw `messages` instead of `flattenedMessages`. An earlier feasibility estimate
judged a few thousand canvas rectangles per frame to be cheap (**inferred**, not measured); this
spec does not re-measure it. If a session with tens of thousands of rows turns out slow, the fix
is to downsample `measurementsCache` to one bucket per output pixel before the main loop, keeping
the shape O(n) rather than changing it. This is a risk below, not pre-built.

## Tests

Red first, per this repo's test discipline.
- **`minimapLayout.test.ts`** (unit, no DOM): row-to-pixel bucketing from a synthetic
  `measurementsCache`; the priority rule when two rows share a pixel; the prompt 2px minimum; the
  y-to-scroll-offset mapping used by click and drag, checked against its own inverse.
- **`SessionMinimap.test.tsx`** (component, needs a mocked 2D canvas context, new to `src/test/`):
  the strip does not render when `isMinimapOpen` is false, when `isCaptureMode` is true, or when
  `isMdUp` is false; the viewport box's `top`/`height` track a given `scrollTop`/`clientHeight`; a
  click calls the scroll handler with the expected offset.
- **`ViewMenuGroup` switch test**: the group renders its "View" heading; toggling the item calls
  `toggleMinimap` and flips `aria-checked`.
- **`minimapSlice` persistence test**: default `false`; `setMinimapOpen` writes and reads back
  through a mocked `localStorage`; a thrown `localStorage` call does not crash the slice.

## Build order

| # | Step | Surface |
|---|---|---|
| 1 | `minimapLayout.ts`: bucketing, priority rule, y-to-scroll mapping, plus unit tests | frontend |
| 2 | `minimapSlice.ts`, registered in `useAppStore.ts`, plus persistence tests | frontend |
| 3 | `useIsMdUp()` in `useMediaQuery.ts`, as `!useIsMobile()` | frontend |
| 4 | `SessionMinimap.tsx`: memoized kind array keyed on `flattenedMessages`, canvas draw loop, device-pixel-ratio handling, theme-change redraw | frontend |
| 5 | Viewport box: position from scroll, click-to-center, drag-to-scroll, pointer capture | frontend |
| 6 | Mount beside `FloatingDateOverlay` in `MessageViewer.tsx`, with list right-padding | frontend |
| 7 | Hide in Capture Mode and below `md`; `aria-hidden` on the strip root | frontend |
| 8 | New `ViewMenuGroup.tsx` with a "View" heading and the switch row, placed after `FilterMenuGroup` | frontend |
| 9 | Keyboard shortcut in `useAppKeyboard.ts` | frontend |
| 10 | i18n keys across five locales, regenerate types, validate | i18n |
| 11 | Component tests for the switch and the visibility rules | frontend |

Steps 1-3 need no UI to review; step 4 is the first visible one. **Effort estimate (low
confidence).** An earlier feasibility estimate, by analogy to similarly sized pieces of this
repository, put this scope at 18 to 26 hours. This spec narrows that slightly and adds the
`useIsMdUp()` gate, so the range holds: roughly three to four focused days, plus half a day to a
day for review. Judgment by analogy, not a measurement.

## Acceptance

1. With `isMinimapOpen` true, not in Capture Mode, viewport at or above `md`, a canvas strip
   renders beside the list with no overlap with its content or the OverlayScrollbars track.
2. The strip's total block height equals its own height, scaled from the scroll content's height
   (`scrollHeight`), regardless of session length.
3. A row classified `prompt` is visible as at least a 2px block even when the average row is
   under 1px tall.
4. When two rows share an output pixel, the one with the higher Design §4 priority wins.
5. The viewport box's height and position track `clientHeight` and `scrollTop` while scrolling,
   verified at the top, middle, and bottom of a long session.
6. Clicking a point on the strip scrolls the list so that point is centered in the viewport.
7. Dragging on the strip scrolls the list continuously while the pointer moves, without invoking
   `navigateToMessage`.
8. Colors change when the app's theme changes, with no reload, verified in light, dark, and at
   least one high-contrast variant.
9. The settings-menu switch sits under its own "View" heading, not under "Filter". It toggles
   `isMinimapOpen`, persists across a reload, and matches "Show system messages" for keyboard and
   screen-reader behavior.
10. The keyboard shortcut toggles the same state as the switch, from anywhere, and does not fire
    inside a text input.
11. The strip does not render in Capture Mode or below `md`, even when `isMinimapOpen` is true.
12. The strip's root carries `aria-hidden="true"` and is not reachable by Tab.
13. `cargo test`, `cargo clippy`, and `cargo fmt --all -- --check` pass unchanged, since
    `src-tauri/` is untouched.
14. `pnpm exec tsc --build .`, `pnpm vitest run`, `pnpm lint`, and `pnpm run i18n:validate` all
    pass.

## Decisions

The author confirmed each of these on 2026-10-05. Each is recorded with the alternative
considered, so a reviewer can tell what was weighed.
1. **The switch goes in a new "View" menu group, not under "Filter".** *Alternative:* a third
   item in the existing `FilterMenuGroup`, which is a smaller change. Rejected because a minimap
   is not a filter, so the "Filter" heading would mislead, and a new group costs only a few lines.
   The settings menu has no existing display heading to reuse (Verified constraints). The row
   itself still copies "Show system messages", as the maintainer's framing asks.
2. **The strip's mount is gated on a new `useIsMdUp()` hook, not CSS-only `hidden md:block`.**
   *Alternative:* copy the Messages panel's CSS-only hiding. Rejected because the strip runs a
   `requestAnimationFrame` draw loop and scroll/resize listeners; `useMediaQuery.ts`'s own
   docstring exists to avoid mounting that work behind a CSS-hidden wrapper.
3. **The keyboard shortcut is Cmd/Ctrl+Shift+F, not Cmd/Ctrl+Shift+O or a variant of
   Cmd/Ctrl+Shift+M.** Cmd/Ctrl+Shift+O was the first choice, for "overview," VS Code's own term
   for this feature. It collides with the browser: Ctrl+Shift+O opens the Bookmarks Manager in
   Chrome and Edge, and the Bookmarks Library in Firefox, on Windows and Linux (each browser's
   own support page confirms this). That only matters for the WebUI (`--serve`) running in a
   real browser tab, not the desktop app, but it still rules the letter out. Four candidates were
   checked against this app's own `keydown` listeners on `develop` (see Verified constraints),
   and against the official shortcut lists for Chrome, Edge, Firefox, and Safari, on Windows,
   Linux, and macOS.
   - *Cmd/Ctrl+Alt+M.* Rejected: it differs from the Messages panel's own shortcut by one
     modifier, inviting mis-presses.
   - *Alt+ArrowUp/Down.* Rejected: `usePromptJump.ts` already owns it (added by PR #629,
     prompt-jump shortcut, now on `develop`).
   - *Cmd/Ctrl+Shift+X.* Considered. No collision found in Chrome's, Edge's, or Safari's own
     shortcut lists. One third-party, non-official page claims Firefox binds it to a
     hex-to-Unicode text conversion. This spec could not confirm that against Mozilla's own
     support page; two fetch attempts against it failed. Flagged **unverified**.
   - *Cmd/Ctrl+Shift+F.* Chosen. No collision found in Chrome's (Windows, Linux, Mac), Edge's
     (Windows, Mac), Firefox's devtools, or Safari's own official shortcut lists. An earlier
     check in this revision wrongly suspected an Edge-on-Mac full-screen conflict; Edge's own Mac
     shortcut list gives full-screen as Cmd+Ctrl+F, not Cmd+Shift+F, so that concern is cleared.
     Firefox's own general, non-devtools shortcut list could not be fetched directly; third-party
     lists of it do not mention Ctrl+Shift+F. This spec treats F as **probably free, medium
     confidence**, not confirmed against Mozilla's own page.

   Neither letter carries a mnemonic the way "O" tied to "overview." The PR therefore presents
   Cmd/Ctrl+Shift+F as a proposal the maintainer can change, both for that reason and because
   the Firefox checks above are not first-party confirmed. A maintainer with a Firefox install can
   confirm either letter in under a minute; see Open questions.
4. **The color source reads `getComputedStyle` at draw time, not a cache set once at mount.**
   *Alternative:* read once and cache. Rejected because the theme-color fix in `1bd82f8b` exists
   precisely so a surface like this repaints correctly on a theme switch with no reload.
5. **`MinimapColorSource` is defined as an interface now, with one implementation.**
   *Alternative:* ship a plain function, refactor later. Rejected because the maintainer named
   the token-cost mode as a likely second step, and the interface costs nothing now.
6. **The strip reuses the Messages panel's five theme colors, and some of the eight kinds share a
   color.** *Alternative:* add new theme tokens so every kind has its own color. Rejected because
   that means new tokens across four theme variants; the priority rule and bar width still
   separate same-color neighbors (Design §5). If screenshots look noisy, color only the key kinds.
7. **No minimap-only color fallback for WebKit without `oklch()`.** *Alternative:* probe
   `oklch()` support once per theme change and fall back to a hand-kept sRGB table. Rejected
   because the whole theme already depends on `oklch()`, so the gap is theme-wide; the PR notes
   carry one optional line for the maintainer instead (Design §5).
8. **The strip is 64px wide, fixed.** That is the prototype's Blocks width, which the maintainer
   was shown on #599. *Alternatives:* 14px (the first build), 32px, or 48px. The first build used
   14px with no source for it; at that width the prototype's pad and gutter leave no room for
   bars. The user chose 64px from rendered 32, 48, and 64px options on 2026-10-06. Scaling with
   window width was also rejected, as unneeded.

## Risks

- PR #632 (turn outline in the Messages panel) is open against `develop` at the same time. It
  moves the per-kind style table out of `NavigatorEntry.tsx` into a new
  `MessageNavigator/kindStyles.ts`, and it adds lines to `MessageViewer.tsx` and
  `messageKinds.ts`. Whichever PR merges second rebases; the overlap is small and mechanical.
- OverlayScrollbars' track: resolved in the browser check. The list's padding moves the
  scrollbar host's right edge to the strip's left edge, so the scrollbar shows inside the list
  area, just left of the strip, with no overlap and no restyling.
- **Row-height estimates can be far off until rows are measured** (measured, not inferred as the
  draft assumed). On one long session, rendering an unvisited region shrank the loaded window
  from 17,406 px to 13,764 px. The strip writes the right `scrollTop` for a click (verified to the
  pixel), but the virtualizer then re-anchors as rows measure, and the strip re-lays itself out:
  a click at 30 percent settled with the box at 11 percent in a fresh window, and at 24 percent
  in a mostly measured one. Better estimates in `heightEstimation.ts` would shrink this; that is
  outside this PR. `measurementsCache` read every animation frame is assumed cheap for a few
  thousand rows, not measured; see Performance budget.
- A mocked 2D canvas context is new test infrastructure. If it proves brittle against this
  repo's pinned Vitest/jsdom versions, more drawing logic may need to move into the pure layout
  helper to keep coverage meaningful.
- **Canvas `fillStyle` may not parse `oklch()` on an old WKWebView.** `tauri.conf.json:61` sets
  this app's own macOS minimum to `10.13`, well before Safari 15.4 added `oklch()`. A failed
  `fillStyle` parse is a silent no-op per the HTML canvas specification, so the strip would paint
  every block black on such a machine, not fail loudly. The rest of the app's colors would
  already be broken there too, since the theme is `oklch()` throughout. By decision 7 the PR
  builds no fallback and flags the gap to the maintainer instead. Not measured against a real
  old-macOS build.

## Revision after the screenshot review (2026-10-06)

Screenshots of the first build, taken from a fictional demo session, were compared with the
prototype the maintainer saw on #599. The build departed from it in five ways, and all five are
fixed in one commit:

1. Bars hugged the strip's right edge. The prototype draws them from a left pad, and §3 already
   said to mirror it. They now start 5px from the left and leave a 7px right gutter.
2. The viewport box had a fill but no edges, so it was nearly invisible in the light theme. It
   now has the prototype's top and bottom edges (§6).
3. The strip had no background or border, so it read as a colored border on the list. It now
   has both (§3).
4. Replies painted as brightly as agent updates. They now paint at reduced strength, as do tool
   calls and injected rows, so prompts, agent updates, and failures stand out (§3).
5. The strip was 14px wide, with no source for that number. It is now 64px (Decision 8).

The wider strip also exposed an older overlap. The floating scroll buttons sit 16px from the
wrapper's right edge, so any strip wider than 16px sat under them. They now move left by the
strip's width while it is shown (§2).

## Open questions

1. For the maintainer: is Cmd/Ctrl+Shift+F an acceptable shortcut, or is Cmd/Ctrl+Shift+X or
   another one preferred? Firefox's own support page could not be fetched to confirm either
   letter is free there; a maintainer with a Firefox install can check this in under a minute.

Resolved on 2026-10-05: the strip's width is fixed (decision 8). The OverlayScrollbars track
needs no restyling; the browser check showed the scrollbar inside the list area, left of the
strip (Risks).

## PR 2: search ticks, not-loaded band, hover previews

> Date: 2026-10-12. The author confirmed decisions P2-1 to P2-3 on 2026-10-12.
> Verified: every line number in this section was checked against `develop` at `e2175dc2`.
> Scope: the three features the maintainer deferred to a second PR on #599. Still
> frontend-only: no Tauri command, no Axum route, no change to `src-tauri/`.

### Verified constraints (PR 2)

- **Search covers the whole session, not the loaded window.** `setSessionSearchQuery` searches
  the result of `fetchFullSessionMessages()` (`store/slices/searchSlice.ts:135,168-171`). A
  `SearchMatch` carries `messageUuid`, `messageIndex`, `matchIndex`, and `matchCount`
  (`store/slices/types.ts:38-43`). `messageIndex` indexes that full array
  (`searchSlice.ts:199-210`), not `flattenedMessages`, so the strip must not use it as a row
  index.
- `MessageViewer.tsx` already derives `matchedUuids`, a `Set` of matched message uuids
  (`MessageViewer.tsx:250-252`), and `currentMatchUuid` (`:255-266`). `uuidToIndexMap` maps a
  uuid to its index in `flattenedMessages` (`hooks/useMessageVirtualization.ts:125`, returned at
  `MessageViewer.tsx:400`). Stepping to a match in an unloaded page already loads it, through
  `ensureMessageLoaded` (`MessageViewer.tsx:714-722`).
- **Pagination is a newest-first window.** `pagination` holds `currentOffset`, `totalCount`,
  `hasMore`, and `isLoadingMore` (`store/slices/messageSlice.ts:125-131`). `currentOffset` is
  the number of messages consumed from the newest end (`fetchWindow`, `:284-323`; set at
  `:381,509`), so `totalCount - currentOffset` is the unloaded count. One page is
  `MESSAGE_PAGE_SIZE = 200` (`:117`).
- **Loading an older page keeps the reader's place.** `handleLoadEarlier` records the first
  visible message row and its on-screen offset before it loads (`MessageViewer.tsx:633-653`).
  After the prepend, a three-pass restore puts that row back in place (`:655-688`). Scrolling
  within 300px of the top also calls it (`:693-709`).
- **Search-highlight tokens exist in every theme variant:** `--highlight`,
  `--highlight-current`, and `--highlight-foreground` (`index.css:142-145` light, `:266-269`
  dark, `:382-384` and `:418-420` high contrast). The list's own match marks use them.
- **Hover text can reuse the Messages panel's helpers.** `previewText(info, toolName)`
  (`MessageNavigator/classifiedRows.ts:44-52`) and `truncatePreview` (`:24-35`) build its row
  previews, used together at `:87-90`. `getKindLabelKey` (`MessageNavigator/kindLabels.ts:15-17`)
  maps a kind to its `navigator.kind.*` label (`i18n/locales/en/message.json:81-88`).
  `NavigatorEntry.tsx` formats a row's time with `useFormat().time`, the app language's clock
  time.
- The strip mounts at `MessageViewer.tsx:1117-1126`, gated by `showMinimapStrip` (`:847`). The
  right gutter is already reserved for ticks: `MINIMAP_TICK_GUTTER_PX = 7`
  (`helpers/minimapLayout.ts:69-70`).
- **Long sessions are common enough to matter.** On the author's machine, 444 of 3,708 local
  Claude Code sessions (12 percent) exceed 200 JSONL lines, 278 (7 percent) exceed 1,000, and
  the longest has 8,415. JSONL lines overcount messages, so these are upper bounds.

### Design (PR 2)

**Geometry.** The band sits at the top of the strip, and the session map fills the rest. One
pure function, `minimapGeometry()` in `minimapLayout.ts`, returns the band height, the map's
top, the map's height, and the scale (`mapHeight / scrollHeight`). The painter, the viewport
box, click, drag, and hover all read from it. This mirrors the prototype's `geometry()`. With
no band, the map's top is 0 and every PR 1 number is unchanged.

**Not-loaded band.**
- The band shows only while `pagination.hasMore` is true.
- Its height is the unloaded share of the strip, `stripHeight * unloaded / totalCount`,
  clamped to at least 24px and at most 25 percent of the strip. The cap wins when the two
  conflict on a very short strip.
- It is a DOM `div` over the canvas, not canvas paint, so a test can read its height. It is
  hatched with `--muted-foreground` at reduced opacity and has a bottom border.
- It shows the unloaded count, grouped in the app language (`useFormat().count`), when it is at
  least 16px tall: the caption chip's 15px line plus a pixel.
- A click calls `handleLoadEarlier`, passed down as a prop, which loads one older page. A press
  on the band never starts a drag. While a page loads, the band pulses and ignores clicks.

**Search ticks.**
- `MessageViewer` passes `matchedUuids`, `currentMatchUuid`, and `getScrollIndex`. Each
  matched uuid resolves through `getScrollIndex` to a row, and then to that row's `start` in
  `measurementsCache`, plus the list offset PR 1 already applies.
- A member of a collapsed agent task or progress group resolves to its group's leader, as a jump to the
  match does. The member's own row is zero-height, so a tick there would sit below the leader.
- One tick per matched message: several matches inside one message share its tick.
- A tick is 5px wide and 2px tall, in the right gutter, 2px from the strip's edge, as the
  prototype draws it.
- The current match's tick is 4px tall. It is drawn last, filled with `--highlight-current`
  inside a 1px `--highlight-foreground` outline. Other ticks are filled with
  `--highlight-foreground`. This is the same token pairing as the list's own current-match mark,
  and it stays legible on the strip's background in every theme variant. `--highlight` alone
  is a pale background tint, close to the strip's own background in the light theme.
- Colors are read at draw time (Decision 4), so ticks follow a theme switch.
- A match in an unloaded page has no row and draws no tick (P2-3). The band's tooltip counts
  those matches. A match whose message the display filter hides also has no row, and gets no
  tick.

**Hover preview.**
- A binary search over `measurementsCache` finds the last row whose `start` is at or before
  the pointer's position, mapped back through the band, the scale, and the list offset. This is the
  prototype's `rowAtOffset()`. Zero-height rows (collapsed agent task group members) never win.
- The tooltip shows the row's kind label and time, then a text snippet of at most 120
  characters, built with `previewText` and `truncatePreview`.
- Over the band, it shows "Not loaded yet", the unloaded count, and any count of unloaded
  matches.
- Date dividers, hidden placeholders, and the list's header or footer show no tooltip.
- The text is recomputed only when the hovered row changes, not on every pointer move,
  because `previewText` runs regexes.
- The tooltip is a positioned `div` to the left of the strip, not the app's `Tooltip`
  component. The strip is `aria-hidden` and has no focusable trigger to attach one to. It hides
  when a drag starts and when the pointer leaves the strip.
- `previewText`, `truncatePreview`, and `getKindLabelKey` are imported from
  `MessageNavigator/`, not moved. `classifiedRows.ts` already imports from
  `MessageViewer/helpers/`, but no file-level import cycle results.

### Decisions (PR 2)

1. **P2-1: the band is proportional, capped at 25 percent of the strip, at least 24px.**
   *Alternatives:* exactly proportional, as the prototype draws it, or a fixed short band. A
   proportional band gives 98 percent of the strip to the band when 200 of 8,415 messages are
   loaded, which squeezes the loaded session into a few pixels. A fixed band says nothing about
   how much is missing.
2. **P2-2: a band click loads one older page, through `handleLoadEarlier`.** *Alternatives:*
   load everything down to the clicked point, or make the band a label only. One page reuses the
   existing anchor restore, so the list does not jump. Loading thousands of rows at once would
   push them all into the virtualizer in one step. The Messages panel's outline chose a label
   with no button (its D10), because the list already loads near its top. The band is different:
   it is a pointer surface beside a list that may not be near its top, and the spec the
   maintainer read on #599 says it "clicks to load older pages".
3. **P2-3: matches in unloaded pages draw no tick; the band's tooltip counts them.**
   *Alternative:* draw them inside the band at estimated positions. `messageIndex` indexes the
   full session after the sidechain and system filters, which need not line up with
   `totalCount`, so an estimated position could mislead. The search toolbar's next and previous
   buttons already load an unloaded match when the reader steps to it.

### Acceptance (PR 2)

1. With `pagination.hasMore` true, a hatched band renders at the top of the strip. Its height is
   `stripHeight * unloaded / totalCount`, clamped to at least 24px and at most 25 percent of the
   strip. With `hasMore` false, no band renders.
2. With a band present, the blocks, the viewport box, click, and drag all map onto the region
   below it. At the top of the scroll content, the box starts at the band's bottom edge. At the
   bottom, it ends at the strip's bottom.
3. Clicking the band calls the list's load-earlier handler once. While a page is loading, a
   click does nothing. A press on the band does not start a drag.
4. After a page loads, the band shrinks, or disappears when nothing is left, and the map
   redraws, with no reload.
5. During a session search, each loaded, displayed message with at least one match has exactly
   one tick in the right gutter, at its row's position. Bars never paint into the gutter.
6. The current match's tick is taller than the others and drawn on top of them. It moves when
   the reader steps to the next or previous match.
7. Matches in unloaded pages draw no tick. The band's tooltip states how many there are.
8. Tick colors come from the search-highlight tokens, read at draw time. They change with the
   theme, with no reload.
9. Hovering a message row shows its kind label, its time, and a snippet of at most 120
   characters. Hovering the band shows the not-loaded text. Hovering a date divider or a hidden
   placeholder shows nothing.
10. The tooltip hides when a drag starts and when the pointer leaves the strip.
11. The strip's root stays `aria-hidden="true"`, and PR 2 adds nothing reachable by Tab.
12. New strings exist in all five locales, with plural forms where a count appears.
    `pnpm run i18n:validate` passes.
13. `pnpm exec tsc --build .`, `pnpm exec vitest run`, `pnpm lint`, and
    `pnpm run i18n:validate` pass. `src-tauri/` is untouched.

### i18n (PR 2)

New keys in `src/i18n/locales/*/message.json`, all five locales, next to the other
`messageViewer.*` keys. English text:

```
messageViewer.minimap.notLoadedTitle             "Not loaded yet"
messageViewer.minimap.notLoadedBody_one          "{{count}} older message. Click to load the previous page."
messageViewer.minimap.notLoadedBody_other        "{{count}} older messages. Click to load the previous page."
messageViewer.minimap.matchesNotLoaded_one       "{{count}} search match is in older messages."
messageViewer.minimap.matchesNotLoaded_other     "{{count}} search matches are in older messages."
```

The band reuses `common.loading` while a page loads. Hover labels reuse `navigator.kind.*`. None
of the new strings names the product, so the Omnilogue rename (#646) does not touch them.

### Tests (PR 2)

Red first, per this repo's test discipline.
- **`minimapLayout.test.ts`:** `minimapGeometry` with no band, a proportional band, the 24px
  floor, the 25 percent cap, and a strip too short for both; `rowIndexAtOffset` on the
  header, inside a row, on a boundary, past the end, and next to zero-height rows; tick
  positions, one per row, with the current tick last.
- **`SessionMinimap.test.tsx`:** the band's height and its absence; a band click calls the
  handler, and a click while loading does not; a band press does not scroll the list; the
  viewport box sits below the band; ticks paint in the gutter, with the current tick taller;
  hover shows a kind label and snippet, and the band text over the band; the tooltip hides on
  pointer leave and on drag.
- **`MessageViewer.minimap.test.tsx`:** the strip receives the search and pagination props.
  The stale stub comment at line 80, written before #632 merged, is reworded.

### Build order (PR 2)

| # | Step |
|---|---|
| 1 | `minimapGeometry`, `rowIndexAtOffset`, and tick positions in `minimapLayout.ts`, with unit tests |
| 2 | The painter, viewport box, click, and drag read the geometry; existing tests stay green |
| 3 | The band `div`, its click, its loading state, and the new props from `MessageViewer` |
| 4 | Ticks on the canvas |
| 5 | The hover tooltip |
| 6 | i18n keys in five locales, regenerated types, validation |
| 7 | Gates, then a browser check on the fictional demo session in light, dark, and high contrast |

### Risks (PR 2)

- **Dragging to the top loads older pages, one per approach (observed 2026-10-12).** A drag
  that brings the list within 300px of its top triggers the list's auto-load, as scrolling
  there does. The anchor restore then keeps the same rows on screen: in the browser check, the
  drag wrote `scrollTop` 0, and 40 ms later the restore wrote 21,062, the same rows' new
  offset. The viewport box moves down the strip as the map rescales, and the next pointer move
  at the top loads the next page. The list never oscillated, and the drag stopped loading once
  every page was in. This behavior predates PR 2 (PR 1 has the same auto-load); suppressing
  auto-load during a drag, so the band is the only load control on the strip, is a possible
  follow-up and is not in this PR.
- **The band moves the map while a page loads.** When a page arrives, the band shrinks and the
  map grows, so every block shifts down. That is correct, but it is visible motion under a
  stationary pointer. The tooltip recomputes on the next pointer move.
- **Hover positions inherit the height-estimate drift** described in PR 1's Risks. A row the
  reader has never scrolled past may sit a few pixels from where the tooltip says it is.
