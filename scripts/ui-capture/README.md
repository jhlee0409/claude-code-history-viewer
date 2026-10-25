# UI capture harness

Deterministic screenshots and layout measurements of the WebUI build, for
before/after evidence on UI pull requests (plan task **T0**). The same commit
captured twice gives **byte-identical pixels** in every scenario (the
reproducibility gate compares raw RGBA values, not pixelmatch's thresholded
count); a changed pixel therefore means the code changed something.

```bash
nvm use                      # Node 22.18.0 (.nvmrc)
pnpm ui:capture              # build, then capture every scenario
pnpm ui:capture --repro      # capture twice on this commit, gate reproducibility (0%)
pnpm ui:capture --base develop --gate unchanged
pnpm ui:capture --base develop --gate unchanged --expect-changed 'home--390x844--dark,settings--*'   # intended changes
pnpm ui:capture --locale ja --only transcript--1440x900--light   # one locale (en | ko | ja | zh-CN | zh-TW)
```

macOS and Linux only: the fixture works by pointing `HOME` at a generated
directory, and Windows resolves the home folder without `HOME`.

## What a run does

1. **Build** (`build.sh`): `vite build` into `.ui-capture/build/dist` and
   `cargo build --features webui-server` (debug) copied to
   `.ui-capture/build/cchv-server`. `--no-build` reuses that head build;
   it does **not** skip the base: a `--base <git-ref>` whose
   `.ui-capture/build-base/<sha>` is absent (every clean CI runner) is still
   built, and reused when an earlier run left it (`lib/artifacts.mjs`).
2. **Fixture** (`fixtures/generate.mjs`): regenerates
   `.ui-capture/fixture/home` from `fixtures/catalog.mjs` (see below).
3. **Server**: `cchv-server --serve --no-auth --host 127.0.0.1 --port <free>
   --dist <dist> --no-watch`, with an environment that contains only `PATH`,
   `TMPDIR`, `HOME=<fixture>`, `TZ=UTC`, `LANG` and
   `GIT_CEILING_DIRECTORIES=<fixture root>` (no `CLAUDE_CONFIG_DIR`,
   `CODEX_HOME` or `XDG_*` can leak the real user's data in).
   `--no-watch` is a hidden test-only server flag that skips the file watcher.
4. **Capture**: Playwright **WebKit 1.63.0**, one fresh browser context per
   scenario, then probes (below).
5. **Compare** (with `--repro` or `--base`): pixelmatch, gate, report.

## What is pinned

| Source of drift | Pinned by |
|---|---|
| Data | Generated fixture home; byte-identical every run (`generate.mjs --verify`) |
| Wall clock | `clock.install` + `pauseAt` at `2026-06-30T00:00:00Z` (09:00 KST), on the context before its page exists (with a page open the two calls race that page's running clock: `test/frozenClock.test.mjs`); timers only run when the settle loop calls `clock.runFor` |
| Locale / timezone | `--locale` (default `ko`) → browser locale; `Asia/Seoul` |
| Pixel density | `deviceScaleFactor: 2` |
| Motion | `reducedMotion: reduce` + injected CSS (`animation`/`transition: none`, no caret, no smooth scroll) + `animations: "disabled"` on the screenshot |
| Theme | `colorScheme` per scenario (the app's default theme is "system") |
| Storage | fresh context per scenario (empty localStorage/IndexedDB), service workers blocked |
| Network | everything that is not the local server is aborted and logged (Google Fonts, update checks) |
| Live updates | server `--no-watch` |
| Pointer | parked at (1,1) after every step, so no hover state or tooltip |

**Settled state** = no tracked request in flight, `data-ready="true"` on the
app root (attribute only; "true" only when no store load - including
incremental "load more" pages and the Edits screen's rows - and no view-level
load registered with `usePendingLoad`, e.g. the Settings Manager's settings
fetch, is pending; the terminal error screen is always "true"),
`document.fonts.status === "loaded"`, and no DOM mutation for 4 consecutive
100 ms steps of virtual time. Virtual time only advances while the app is
network-idle, so debounces and deferred effects run in a fixed order.

## Scenarios

Declared in `scenarios.mjs` (one place; edit there). Id =
`<screen>--<viewport>--<theme>`, e.g. `transcript--1440x900--dark`.

- Viewports: `1180x760`, `1440x900`, `1920x1080`, `390x844` (mobile).
- Themes: `dark`, `light`.
- Screens: `home`, `transcript` (the 1,369-message session), `analytics`,
  `analytics-tokens` (the analytics Tokens sub-tab; token stats before T9b), `recent-edits`, `board`, `global-stats`, `archive`,
  `settings` (Settings Manager), two highlight-regression flows from the
  UX audit (`global-stats-after-analytics`: a project's analytics, then
  global stats; `archive-after-global-stats`: global stats, then the
  archive), plus five states produced by request
  injection (`page.route` on `/api/<command>`):
  - `empty` - `scan_projects` / `scan_all_projects` answer `[]`
  - `empty-first-launch` - the same, with `load_user_metadata` answering no
    saved provider discovery (first launch: Claude Code scanned only)
  - `loading` - the same requests are held (never answered)
  - `error` - `get_claude_folder_path` fails with `PERMISSION_DENIED`
  - `analytics-error` - the large session's project analytics, with
    `get_project_stats_summary` failing (500 `boom`): the dashboard's own
    error state, not a stuck loading text
- Mobile adds `sidebar` (project drawer open).
- Inner-UI (plan I0): `transcript-mixed-turn`, `x-transcript-edit-expanded`,
  `transcript-run-open`, `transcript-failure`, `transcript-unknown-outcome`,
  `transcript-failure-open`, `transcript-unknown-outcome-open` (TR0: the
  failed / interrupted / no-result and E15 rows opened), `transcript-cjk`, `subagent`, `no-matches`, `unreadable-source`,
  `analytics-lowdata`, `edits-patch-only`, `settings-dirty`, `archive-error`
  at 1440×900 dark/light, 1180×760 dark and 390×844 dark, and `gear`
  (desktop). New steps: `expandToolRows`, `gearMenu`, `transcriptSearch`,
  `settingsToggle`.
- TR2a (DiffView, D5): `transcript-edit-menu-open` (the opened Edit's `…`
  menu), `transcript-edit-side-by-side` (Side by side chosen from it),
  `recent-edits-diff` and `recent-edits-compact-diff` (the Edits screen's
  full diff, comfortable and compact rows) at 1440×900 dark/light and
  390×844 dark. Steps `diffMenu` (`mode` optional) and `editsDiff`
  (`compact`). A `…-menu-open` screen ends with a modal menu, so the row and
  chrome probes do not apply there. The transcript pair is new from TR2a
  (no menu on an older base).
- Font scale (T4 / D9): `transcript` and `analytics` at **90 %** and
  **110 %** (`<screen>-scale90`, `<screen>-scale110`), 1440×900 light. The
  first step sets the app's own font-size setting through the gear menu
  (`{ do: "fontScale", percent }`); the WebUI does not restore a stored scale
  at startup, so seeding storage would not work.

Desktop 3 × 2 × 16 + mobile 1 × 2 × 17 + measurement pair 3 × 1 × 2 + font
scale 1 × 1 × 4 + library (T7) + conversation tabs (T8): `tabs-three` and
`tabs-overflow` at 1180×760 and 1440×900, `tabs-mobile` and
`tabs-mobile-sheet` at 390×844, both themes. A tab scenario declares how
many tabs the measurement probe must find (`tabs`, default 1).

### Tab timing (T8, plan §4.3 / F6)

The capture pauses the page clock, so tab timing runs separately, with a
real clock, on the same build and fixture:

```bash
node scripts/ui-capture/measure-tabs.mjs --out scratch/t8/timing   # after one capture run (build)
```

It opens the 1,369-message session and a second session with ⌘+click, then
measures 10 times each: switching back to the large tab until its saved
anchor message is on screen and the app is settled (`switch`, target median
≤ 500 ms), the first activation after a page load (`first`, ≤ 1,500 ms) and
switching back when the anchor lives in an older page (`oldPage`,
≤ 2,000 ms). Median, p90 and the anchor's pixel drift go to `timing.json`.
The server is the harness's debug build, so the desktop release app is not
slower than these numbers.

## Output

```
.ui-capture/                      (gitignored)
  build/{dist,cchv-server}        head artifacts
  fixture/home, fixture-manifest.json
  runs/<date>-<sha>/              one run (`runs/latest` links the newest)
    shots/<id>.png                screenshots (DPR 2)
    probes/<id>.json, probes.json numeric probes
    logs/<id>.json                blocked requests, injections, console errors
    manifest.json                 git sha, locale, fixture digest, versions, per-scenario results
    server.log
    compare/report.{md,json}, compare/diff/<id>.png
  baselines/<sha>-<locale>-<harness>/   cached captures of --base <git-ref>
  approved/<id>.png, approved.json      approved baselines for --gate changed
```

## Probes

Measured after the screenshot, written per scenario:

- `mainWidth`: `[data-slot=main]` `getBoundingClientRect().width` - the main
  pane, not a reading column.
- `projectRows.fullyVisible`: `[data-row=project]` rows fully inside the
  sidebar scroll area (intersection of the window and every clipping
  ancestor). Session rows, library rows and "show all" never carry
  `data-row=project`. `fullyVisibleExcludingExpanded` drops rows with
  `aria-expanded="true"`.
- `minFontSize.px`: smallest computed `font-size` of any rendered, visible
  text node (sr-only and fully clipped text excluded), sampled at evenly
  spaced scroll positions of the largest scrollable containers, so
  virtualized lists are sampled beyond the first screen. `at` names the
  element that produced it. At the first view and at every scroll position
  the probe also opens the collapsed content in view inside the main pane
  (disclosure controls with `aria-expanded="false"` that are not menus,
  comboboxes or tree rows, and closed `<details>`), lets the page settle and
  samples again, so a small font behind a collapsible (tool output, thinking,
  diffs) is included. `expandedControls` / `expandedPositions` record how much
  was opened. This runs after the screenshot and never affects pixels.
  Regression test: `test/probes.test.mjs` (real WebKit).

### Typography (T4, C5)

`lib/typography.mjs` → `typography` in each probe JSON, measured after the
other probes:

- `lang` (html[lang]), `appFontScale` (`--app-font-scale` on html),
  `bodyFontFamily` (computed, i.e. the per-language font order);
- `steps`: the computed size and line height of every type step
  (`caption 12 / list 13 / body 15 / code 13 / title 17`, analytics aliases
  `lg 18 / xl 20 / 2xl 24`), from a hidden probe span per step class, so a
  step is checked even on a screen that does not use it;
- `used`: the sizes visible elements carrying a step class actually render at
  (`usedAt` names one class list per size);
- `problems`: `checkTypography` against the run's locale and the scenario's
  scale: html[lang] = locale, `--app-font-scale` = scale, font order =
  `FONT_STACKS[locale]`, body line height 1.7 (ko / ja / zh) or 1.55 (en),
  every step and every used size = base × scale ±0.5 px, and `minFontSize.px`
  ≥ 12 px at 100 % (≥ 12 × scale − 0.5 px otherwise).

Any problem fails the scenario on this checkout's captures. A `--base`
capture records them but never fails on them: it is the "before". For the
five-language check run the same scenarios once per `--locale`.

### Measurement state (C4)

Every scenario starts from the C4 measurement state declared in
`scenarios.mjs` → `MEASUREMENT_STATE`: sidebar **260 px**, scale **100 %**,
inspector **closed**, **one tab** (font-scale scenarios: their own scale;
tab and inspector scenarios: their own `tabs` / `inspectorOpen`).
`STORAGE_SEED` writes the app's own storage keys (`sidebar-width=260`, the
inspector's record `inspector.v1` = closed, and the message navigator's
`navigator-open=false`, which builds before T9a read instead) before the
first app script; app defaults are untouched. Scale 100 % is the default of
a fresh context. Each probe JSON records `measurementState` (measured
sidebar width, root font size, `appFontScale` = `--app-font-scale`, stored
inspector flag - `inspector.v1`'s `open`, else `navigator-open` - sessions
layout, selected / expanded project rows, open tabs), and a scenario fails
when the measured state differs (desktop sidebar width, inspector flag,
root font size 16 px, `--app-font-scale` = the scenario's scale).

Inspector (T9a): `inspector-<outline|tokens|info>--<1440x900|1180x760>--<theme>`
open the inspector on that tab beside the large transcript through stored
state (`inspectorStorage`), as a relaunch restores it. A base build before
T9a reads `navigator-open=true` from the same seed and shows its message
navigator open, so each pair is the before/after of that tab.
`inspector-outline--390x844--dark` checks that a stored open inspector does
not show on a phone.

Project-row pair (C4 D3), desktop sizes, dark:

- `projects-collapsed--<size>--dark`: every project row collapsed, none
  selected (`collapseProjects` asserts it).
- `projects-expanded--<size>--dark`: exactly one project open
  (`expandProject` asserts it). Where the layout shows sessions inline the
  row is `aria-expanded="true"` and counted in `projectRows.expanded`; at
  lg+ widths the app shows the open project's sessions in the sessions pane
  instead (`measurementState.sessionsLayout: "pane"`, one selected row, no
  inline expansion), which is recorded as such rather than faked.

## Variants (inner-UI plan I0)

Media and environment emulation, chosen per run (flags) or per screen
(`variant: { ... }` in `scenarios.mjs`). Precedence, lowest first: harness
defaults → a test's `contextOptions` → the scenario's `variant` → the run's
flags (`lib/variant.mjs`, unit-tested in `test/browser.options.test.mjs`).
Before I0 the defaults were spread after `contextOptions`, so nobody could
capture with motion, forced colours or another time zone.

| Flag | Values | Effect |
|---|---|---|
| `--forced-colors` | `none` (default) \| `active` | Playwright `forcedColors` (WebKit and Chromium) |
| `--contrast` | `no-preference` (default) \| `more` | `prefers-contrast` |
| `--motion` | `reduce` (default) \| `full` | `prefers-reduced-motion` |
| `--font-scale` | factor, e.g. `1.25` | root font size 16 × f (a browser/OS text size; the rem-based type steps follow); the measurement state and typography checks expect it |
| `--timezone` | IANA zone (default `Asia/Seoul`) | browser time zone (the server stays `TZ=UTC`) |
| `--viewport` | `WxH`, e.g. `1180x800` | the selected screens at that size; ids follow (`transcript--1180x800--dark`) |
| `--inspector` | `open` \| `closed` | the stored inspector state (and the expected measurement state) |
| `--live` | – | **live interaction mode**, below |

The run dir, `manifest.json → variant` and the `--base` cache key carry the
variant (`<stamp>-<sha>-font125+vp-1180x800+inspector-open`), so a base is
only reused for the same variant.

```bash
pnpm ui:capture --viewport 1180x800 --inspector open --only transcript-mixed-turn
pnpm ui:capture --font-scale 1.25 --only transcript--1440x900--light
pnpm ui:capture --forced-colors active --only settings--1440x900--dark
```

### Live interaction mode (`--live`)

The deterministic capture injects `animation: none; transition: none;
scroll-behavior: auto` and freezes the clock, so no motion test can fail in
it. `--live` leaves CSS motion alone and runs on the real clock (settle and
probes wait real time); caret hiding and mutation counting stay. It is for
interaction tests (`motionActivity`, F1b's reduced-motion test) and refuses
`--repro` / `--base`: live captures are not pixel-stable.
`test/liveMode.test.mjs` proves a known CSS transition is observed in
`--live` (and suppressed in the capture mode) - without that proof every
later motion test would be meaningless.

## Inner-UI probes (plan I0, `lib/innerProbes.mjs`)

Measured after the screenshot, written to `probes/<id>.json → inner`. Every
probe reports `{ population, selector, value, applicable }`:

- **applies** (declared per probe in `PROBE_APPLICABILITY`, by screen,
  locale, viewport, theme, live): an **empty population fails the
  scenario** - nothing measured is not "nothing wrong";
- **does not apply**: `applicable: false`, never a vacuous pass.

| Probe | D | Applies to | Measures |
|---|---|---|---|
| `absPathLeaks` | D1 | transcript\*, recent-edits\*, board\*, inspector-info, edits-patch-only | visible text with an absolute path (`/Users/…` and other POSIX roots, `C:\`, UNC, `\\?\`, `/mnt/c`) outside code/output wells (`pre, code, [data-output], [data-code], [data-mono=code\|diag], [data-path-kind=absolute]`); title/aria/copy text is not text |
| `toolRowMetrics` | D2 | transcript\* (not the dock pair) | `[data-tool-row]`, else today's `[data-message-uuid] button[aria-expanded]`: font size, row height, clipped names |
| `wordBreak` | D12 | every scenario in ko/ja/zh, `transcript-cjk` | computed `word-break` of CJK text per language |
| `cjkLeading` | D12 | `transcript-cjk` | multi-line CJK text with line-height/font-size < 1.5 |
| `leftEdges` | D20 | desktop work screens | page title x vs first content column x: text below the page header (its subtitle is header, not content), controls excluded, leftmost; on Edits the file name column. `alignedWithin2px` counts the ±2px criterion |
| `overflowX` | D25 | all | page overflow and clipped/spilling boxes (scrollers and ellipsis excluded) |
| `cards` | D20 | work screens | bordered rounded boxes, nesting, radii (`pill` for fully round) |
| `chromeSelect` | D24 | desktop, no modal, not the terminal error screen | selectable text in the chrome |
| `focusVisible` | D7 | home, transcript, settings at 1440 dark | first 24 Tab stops (Alt+Tab in WebKit): focused vs blurred crop changes (`lib/statesJudge.mjs`), in view, not covered (`elementFromPoint`) |
| `motionActivity` | D8 | `--live` only | after opening the first collapsed row: `getAnimations()` at 0/16/100 ms, transition/animation events, scroll frames |

Unit tests on fake pages: `test/innerProbes.test.mjs` (a leak counts 1, a
title-only path 0, `C:\` / UNC / `/opt` 1 each, an output well 0, nothing
visible = an empty population that fails, …).

## Inner-UI fixture cases (`fixtures/inner.mjs`)

Five more projects on their own PRNG streams: every catalog file stays
byte-identical (`test/fixtureInner.test.mjs`; against develop's generator
only `user-data.json` changes, because OpenCode is now discovered).
Scenarios open a case by key (`{ do: "openSession", session: "<key>" }`,
`manifest.namedSessions`):

| Key | What |
|---|---|
| `mixed-turn` | text → Read·Grep ×4 (success) → Edit diff → failing test (exit 1); short and very long paths; three `index.ts` |
| `outcomes` | explicit exit 1, stderr warning + exit 0, API `error_code`, `is_error:false` + exit 2, interrupted + exit 130, a call without a result, an orphan result |
| `unknown-outcome` | E15 byte for byte: empty stdout, fatal stderr, `interrupted:false`, no exit code, no `is_error` |
| `blocks` | thinking, web search, citations, image, document, an unknown block |
| `cjk-ko` / `cjk-ja` / `cjk-zh-CN` / `cjk-zh-TW` | titles and bodies mixing prose, paths and code |
| `usage-mix` / `usage-cache` | two models and two tiers in one session; cache-read heavy |
| `patch-only` | Codex, apply_patch rows only, one three-file patch |
| `opencode-edits` | OpenCode JSON storage: `edit` fragment, `multiedit` input, empty `write`, source cost only |
| `giant-turn` / `ten-thousand` | one 2,000-block turn; a 10,000-message session |

Already in the catalog: an edit missing on disk, single-session projects,
the subagent session, sessions in the last 7 and the prior 7 days.

## Later-active scenarios (`activatesWith`)

A screen with `activatesWith: "<task id>"` is a scenario of a surface that
does not exist yet (or a state I0's injection steps did not reach on
today's screen). It is expanded like any other, **not run**, and listed in
`manifest.json → inactive` with its `before`: the old counterpart to compare
with, or `new-surface` (no before; the first approved capture is the
baseline). The owning task turns it on by deleting `activatesWith` (its
STOP WHEN). Today: `analytics-activity`, `session-detail-sheet` (AN1),
`journey-evidence` (EV2), `file-history` (EV3b), `partial-provider`,
`stale-data` (SX1), `settings-invalid`, `settings-inherited` (SE1),
`archive-progress`, `archive-result` (AR1). A "success capture" of an
unbuilt screen is never invented.

## Primitive states gallery (`pnpm ui:states`)

`states/gallery.tsx` renders the real `src/components/ui` primitives with the
app's `index.css`; `states/run.mjs` measures each control instance at rest,
on hover, on keyboard focus (reached by Tab / Alt+Tab, so `:focus-visible`
matches) and pressed, plus the static states (disabled, aria-disabled,
loading, error, selected, checked) against the control's default, in WebKit
light/dark and Chromium forced colours light/dark. Output:
`.ui-capture/states/<stamp>/{summary.json,<run>/{gallery.png,states.json,crops/}}`
(`latest` links the newest). Exit 1 on an empty gallery or a failed run;
the visibility judgement is `lib/statesJudge.mjs` (`test/states.test.mjs`).

## Browser tests in CI (`CI_REQUIRE_BROWSER`)

Browser suites read `test/requirements.mjs`: locally a missing WebKit,
Chromium or harness server skips them with a warning; with
`CI_REQUIRE_BROWSER=1` a missing one is an error. The `ui-harness` job of
`.github/workflows/frontend-tests.yml` runs, on a clean Ubuntu runner:
install (Node from `.nvmrc`) → read the PR body's `ui-expected-changes:`
line (below) → Rust + the Linux packages of
`rust-tests.yml` → `playwright install --with-deps webkit chromium` →
`build.sh` → `vitest run scripts/ui-capture` with `CI_REQUIRE_BROWSER=1` →
`ui:states` → `ui:capture --no-build --base <base> --gate unchanged
--scenarios scripts/ui-capture/ci-scenarios.mjs [--expect-changed <ids>]`.

### Intended changes in a pull request (`ui-expected-changes:`)

The CI gate is the unchanged gate, and approved baselines (`--gate changed`)
are local, so CI learns about an intended change from the pull request
itself. Put this line in the **PR body**:

```text
ui-expected-changes: home--390x844--dark, transcript-mixed-turn--*
```

- Ids exactly as in `ci-scenarios.mjs` (`--list` prints them), separated by
  commas; an entry may end in `*` to match an id prefix (`home--*`). A bare
  `*` is refused.
- The line counts when it starts with `ui-expected-changes:` (leading
  spaces, the key's case and a surrounding code fence do not matter);
  several lines are merged. A line inside an HTML comment (`<!-- -->`)
  does not count: reviewers cannot see it. A line with no ids declares
  nothing.
- Each listed scenario may exceed 0.1 % and is reported as
  `expected-change` with its % (report table, an "Expected changes" list,
  `report.json` → `expectedChanges`, the job log). Every other scenario
  keeps the 0.1 % rule. Diff images stay in the uploaded artifact as the
  evidence to review.
- A declared entry under which nothing changed by more than 0.1 % gives a
  warning line (`report.json` → `warnings`), not a failure: the
  declaration is stale or wrong.
- Malformed text, or an entry that matches no scenario of the CI subset,
  fails the step "Expected visual changes (PR body)" right after install
  (exit 2), a minute in instead of after the builds.
- Editing the PR body re-runs the workflow (`pull_request` type `edited`),
  so fixing the line re-runs the gate. The trigger is per workflow, so an
  edit (CodeRabbit's summary included) also re-runs the `frontend` job.
- Nothing is committed: the declaration lives and dies with its pull
  request. A push to `develop` has no PR body and gates strictly.
- When the gate fails, the report ends with the declaration for the
  changed scenarios (`PR body (CI):  ui-expected-changes: …`); review the
  diff images before you copy it. The key never starts a report line, so a
  report pasted into the PR body declares nothing.

Security: the body is untrusted input. The workflow passes it to
`expected-changes.mjs` only as the environment variable `PR_BODY`, never as
`${{ }}` inside a `run` script, and the script prints only ids, `*` and
commas (`test/ciScenarios.test.mjs` checks the workflow;
`test/expectedChanges.test.mjs` the parser).

Locally the same list is `--expect-changed`:

```bash
pnpm ui:capture --no-build --base develop --gate unchanged \
  --scenarios scripts/ui-capture/ci-scenarios.mjs --expect-changed 'home--390x844--dark,transcript-mixed-turn--*'
```

### CI scenario subset (`ci-scenarios.mjs`)

PRs and pushes gate **32 exact ids** (`CI_SCENARIO_IDS`, 64 captures with
the base), not the full matrix (~259 pairs, ~30 min of capture). The module
re-exports `scenarios.mjs` and adds `SELECTED_IDS`; `run.mjs` then runs
exactly those ids (`lib/selection.mjs`: an unknown, inactive or repeated id
is a usage error). Unlike `--only`, nothing is substring-matched
(`analytics--1440x900--dark` does not pull in
`global-stats-after-analytics--…`). `test/ciScenarios.test.mjs` pins the set.

```bash
pnpm ui:capture --scenarios scripts/ui-capture/ci-scenarios.mjs --list   # print the ids
pnpm ui:capture --no-build --base develop --gate unchanged --scenarios scripts/ui-capture/ci-scenarios.mjs
```

The full matrix stays the default locally and runs in CI on a manual
dispatch of `frontend-tests.yml` with `full_matrix: true` (input `base_ref`,
default `origin/develop`). The subset is the automatic regression gate
only; a UI task still owes the full scenario-specific evidence (locales,
font scale, inspector, …) for the surfaces it changes.

## Baseline freeze (`specs/2026-10-18-inner-ui/baseline.json`)

`freeze-baseline.mjs` writes the measured "before": revision, fixture
digest (`generate.mjs --verify`), Playwright/WebKit/Chromium builds, OS and
machine model, font scales, and per D metric the probe, selector,
scenarios, population and value (`lib/baseline.mjs`). D metrics no I0
probe measures name the task/test that will.

```bash
pnpm ui:capture --no-build --repro
pnpm ui:capture --no-build --font-scale 1.25 --only <screens>
pnpm ui:states
node scripts/ui-capture/freeze-baseline.mjs --run .ui-capture/runs/<repro>/run-1 \
  --run .ui-capture/runs/<font125> --repro-report .ui-capture/runs/<repro>/compare/report.json \
  --states .ui-capture/states/latest/summary.json --out specs/2026-10-18-inner-ui/baseline.json
```

After a probe fix, re-freeze only that probe (everything else stays as
frozen; the run must judge the same number of scenarios, and `remeasured`
records the run, revision, harness digest and reason):

```bash
node scripts/ui-capture/freeze-baseline.mjs --update-probe leftEdges \
  --run .ui-capture/runs/<run> --reason "<why>" --out specs/2026-10-18-inner-ui/baseline.json
```

## Gates

| `--gate` | Passes when | Use for |
|---|---|---|
| `reproducibility` (default) | every scenario has **0 exactly differing pixels** (raw RGBA, same size; pixelmatch's threshold does not apply) | `--repro`; PRs that must not change pixels |
| `unchanged` | every scenario ≤ **0.1 %** changed pixels, except the scenarios named by `--expect-changed` (exact ids or `<prefix>*`), which may exceed it and are reported as `expected-change` | refactors with no intended visual change; the CI gate, where a PR declares its intended changes with a `ui-expected-changes:` body line ([below](#intended-changes-in-a-pull-request-ui-expected-changes)) |
| `changed` | a scenario **with** an approved baseline must match it (≤ 0.1 %); a scenario **without** one must stay within the unchanged tolerance (≤ 0.1 %) of the base, so tolerated noise never needs approval | intended visual changes, locally |

The 0.1 % tolerance counts pixelmatch-changed pixels (threshold 0.1,
anti-aliasing ignored, as pixelmatch does by default); the report lists both
that count and the exact (byte-level) differing pixel count, and only the
latter decides `reproducibility`. Gate semantics are unit-tested in
`test/compare.test.mjs` (`pnpm exec vitest run scripts/ui-capture`).
In every mode a scenario missing on either side - removed from
`scenarios.mjs`, failed to capture, or absent from the base - fails the gate
(a declared expected change does not excuse a missing capture).

`--expect-changed` (unchanged gate only): an entry that matches none of the
selected scenarios is a usage error, checked before anything is built or
captured, so a typo fails at once. A declared entry under which no
scenario changed by more than 0.1 % is a warning, not a failure.

**Exit codes**: `0` all captured and the gate passed (expected changes and
warnings included); `1` any scenario failed, any declared scenario is
missing, the build failed, or the gate failed; `2` usage error (including a
malformed `--expect-changed` list or an entry that matches no selected
scenario).

### Comparing with a base

- `--base <dir>`: a previous run dir (uses its `shots/`, or `run-1/shots/`
  of a `--repro` run) or a directory of `<id>.png` files.
- `--base <git-ref>`: the ref is checked out into a temporary worktree,
  built (sharing `src-tauri/target`, so only this crate recompiles) and
  captured **with the current harness**, then cached under
  `.ui-capture/baselines/` keyed by sha, locale and harness digest. Builds
  older than this harness lack the `data-*` markers; capture still works
  (the settle loop falls back to network + DOM quiescence) but probes report
  `null`/`0` there.

### Approving baselines (`--gate changed`)

1. Capture the change and look at the diff images:
   `pnpm ui:capture --base develop --gate changed` → fails with
   `unapproved-change` rows; review `runs/latest/compare/diff/*.png` and the
   shots.
2. When the new look is the intended one, approve it:
   `pnpm ui:capture --approve-from .ui-capture/runs/latest` (optionally
   `--only <ids>`), or capture-and-approve in one go with `--approve`.
3. Re-run with `--gate changed`: changed scenarios now pass against the
   approved images, and every other scenario must still be within 0.1 % of
   the base. An approved scenario whose head no longer matches its approved
   image (e.g. the intended change was lost) fails as `differs-from-approved`.

Approved baselines are local (`.ui-capture/` is gitignored); attach the
shots and diffs to the PR as evidence. CI never sees them: in a pull
request, declare the intended changes with the body line
`ui-expected-changes:` instead
([Intended changes in a pull request](#intended-changes-in-a-pull-request-ui-expected-changes)).

## Fixture

`fixtures/generate.mjs` writes, under `<root>/home`:

- 19 Claude Code projects (`.claude/projects/<encoded-cwd>/<uuid>.jsonl`) and
  6 Codex CLI projects (`.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) from the
  catalog, plus the inner-UI cases (3 Claude, 1 Codex, 1 OpenCode JSON-storage
  project, see "Inner-UI fixture cases"), each
  with an existing working directory under `home/work/...` (otherwise the app
  flags projects as "location unavailable");
- `atlas-web` (newest, opened by every project-level scenario) with the
  **1,369-message** session, a session whose `Task` call spawned a subagent
  (`<session>/subagents/agent-<id>.jsonl` + `.meta.json`, `isSidechain`),
  Edit/Write/Read/Bash/Grep tool calls with `toolUseResult`, so Recent Edits
  and Board have data (all edited files exist on disk except
  `docs/architecture.md`, to show both states);
- `.claude/settings.json`, one archive (`.claude-history-viewer/archives`),
  and `.claude-history-viewer/user-data.json` with
  `settings.discoveredProviderIds: ["claude","codex"]` so Codex is scanned on
  startup without provider discovery.

All timestamps lie before the frozen clock and more than 30 days before any
real capture date, so the server's real-clock archive expiry check is stable.
Ids are hashes of stable labels; all randomness is a seeded PRNG; file and
directory mtimes are pinned. `node scripts/ui-capture/fixtures/generate.mjs
--verify` generates into two roots (and one twice) and checks the trees are
identical modulo the root path. The root path itself does appear in the data
(`cwd`, encoded project folder names), because the app needs real absolute
project directories; it is always `.ui-capture/fixture` of this checkout, for
head and base captures alike.

**No tied tool counts.** The backend ranks "most used tools" by count only
and leaves ties in `HashMap` iteration order, which is random per server
process (`build_tool_usage_stats` in `src-tauri/src/commands/stats.rs`), so
two tools with equal counts swap places in the Analytics and Global Stats
charts between runs. The generator therefore picks tools as a strict
staircase per transcript (`TOOL_RANKING`) and refuses to write a fixture in
which two tools share a count in any session, project or the whole home, in
either stats mode (`assertNoToolTies`). Other lists the backend returns in
`HashMap` order (`activity_heatmap`, per-session `most_used_tools`) are not
rendered today; if a screen starts showing one, give the fixture the same
treatment or sort it in the app.

Bump `FIXTURE_VERSION` in `catalog.mjs` when you change generated bytes on
purpose; captures of the old and new fixture are not comparable.

## Known limits

- **Fonts**: IBM Plex Sans / JetBrains Mono are bundled (`src/assets/fonts`),
  so the external-request block no longer changes rendering. CJK text uses
  the OS fonts (per-language order in `index.css`).
- **Same machine only**: screenshots depend on the OS font stack, the WebKit
  build and the checkout path (shown inside the app). Compare captures made
  on the same machine; do not commit baselines from one machine for another.
- **Machine-level inputs** outside `HOME` that the app still reads, e.g.
  `/Library/Application Support/ClaudeCode/managed-settings.json` (Settings
  Manager). They are stable on one machine but not across machines.
- **App cache writes**: opening a Claude project writes
  `.session_cache.json` into the fixture; it is regenerated every run and
  scenarios always run in the same order. Any other write the app makes is
  listed in `manifest.json` → `fixture.changedByRun` and printed.
- **Desktop-only chrome** (traffic-light inset, native menus, window state)
  is not part of the WebUI and cannot be captured here.
- One run at a time per checkout: runs share `.ui-capture/fixture`, so a
  second run refuses to start while `.ui-capture/run.lock` names a live
  process.
- **Process ownership**: `lib/lifecycle.mjs` owns the server and browser of a
  capture; any failure after the server is up (browser launch included)
  closes the browser and stops the server before the error propagates, and a
  `--base <ref>` worktree is removed even when `git worktree add` itself
  fails half-way. Fault-injection tests: `test/lifecycle.test.mjs`.

## Troubleshooting

- `Executable doesn't exist ... webkit-2359`: `pnpm exec playwright install webkit`.
- `settle timeout`: the screen kept mutating or a request never finished;
  the error names pending/held counts and the last ready/fonts state.
  `logs/<id>.json` lists console errors.
- `build failed`: run `bash scripts/ui-capture/build.sh . .ui-capture/build/dist .ui-capture/build/cchv-server`
  to see the full output.
