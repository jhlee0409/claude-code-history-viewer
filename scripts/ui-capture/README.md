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
pnpm ui:capture --locale ja --only transcript--1440x900--light   # one locale (en | ko | ja | zh-CN | zh-TW)
```

macOS and Linux only: the fixture works by pointing `HOME` at a generated
directory, and Windows resolves the home folder without `HOME`.

## What a run does

1. **Build** (`build.sh`): `vite build` into `.ui-capture/build/dist` and
   `cargo build --features webui-server` (debug) copied to
   `.ui-capture/build/cchv-server`. `--no-build` reuses both.
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
| Wall clock | `page.clock.install` + `pauseAt` at `2026-06-30T00:00:00Z` (09:00 KST); timers only run when the settle loop calls `clock.runFor` |
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
incremental "load more" pages and the recent-edits dock - and no view-level
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
  `token-stats` (legacy), `recent-edits`, `board`, `global-stats`, `archive`,
  `settings` (Settings Manager), two highlight-regression flows from the
  UX audit (`global-stats-after-analytics`: a project's analytics, then
  global stats; `archive-after-global-stats`: global stats, then the
  archive), plus four states produced by request
  injection (`page.route` on `/api/<command>`):
  - `empty` - `scan_projects` / `scan_all_projects` answer `[]`
  - `loading` - the same requests are held (never answered)
  - `error` - `get_claude_folder_path` fails with `PERMISSION_DENIED`
  - `analytics-error` - the large session's project analytics, with
    `get_project_stats_summary` failing (500 `boom`): the dashboard's own
    error state, not a stuck loading text
- Mobile adds `sidebar` (project drawer open).
- Font scale (T4 / D9): `transcript` and `analytics` at **90 %** and
  **110 %** (`<screen>-scale90`, `<screen>-scale110`), 1440×900 light. The
  first step sets the app's own font-size setting through the gear menu
  (`{ do: "fontScale", percent }`); the WebUI does not restore a stored scale
  at startup, so seeding storage would not work.

Desktop 3 × 2 × 15 + mobile 1 × 2 × 16 + measurement pair 3 × 1 × 2 + font
scale 1 × 1 × 4 = **132 scenarios**.

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
inspector **closed**, **one tab** (font-scale scenarios: their own scale).
`STORAGE_SEED` writes the app's own storage keys (`sidebar-width=260`,
`navigator-open=false`) before the first app script; app defaults are
untouched. The right-hand message navigator is today's inspector; scale 100 %
is the default of a fresh context; the app has no tab UI yet. Each probe JSON
records `measurementState` (measured sidebar width, root font size,
`appFontScale` = `--app-font-scale`, stored inspector flag, sessions layout,
selected / expanded project rows), and a scenario fails when the measured
state differs (desktop sidebar width, inspector flag, root font size 16 px,
`--app-font-scale` = the scenario's scale).

Project-row pair (C4 D3), desktop sizes, dark:

- `projects-collapsed--<size>--dark`: every project row collapsed, none
  selected (`collapseProjects` asserts it).
- `projects-expanded--<size>--dark`: exactly one project open
  (`expandProject` asserts it). Where the layout shows sessions inline the
  row is `aria-expanded="true"` and counted in `projectRows.expanded`; at
  lg+ widths the app shows the open project's sessions in the sessions pane
  instead (`measurementState.sessionsLayout: "pane"`, one selected row, no
  inline expansion), which is recorded as such rather than faked.

## Gates

| `--gate` | Passes when | Use for |
|---|---|---|
| `reproducibility` (default) | every scenario has **0 exactly differing pixels** (raw RGBA, same size; pixelmatch's threshold does not apply) | `--repro`; PRs that must not change pixels |
| `unchanged` | every scenario ≤ **0.1 %** changed pixels | refactors with no intended visual change |
| `changed` | a scenario **with** an approved baseline must match it (≤ 0.1 %); a scenario **without** one must stay within the unchanged tolerance (≤ 0.1 %) of the base, so tolerated noise never needs approval | intended visual changes |

The 0.1 % tolerance counts pixelmatch-changed pixels (threshold 0.1,
anti-aliasing ignored, as pixelmatch does by default); the report lists both
that count and the exact (byte-level) differing pixel count, and only the
latter decides `reproducibility`. Gate semantics are unit-tested in
`test/compare.test.mjs` (`pnpm exec vitest run scripts/ui-capture`).
In every mode a scenario missing on either side - removed from
`scenarios.mjs`, failed to capture, or absent from the base - fails the gate.

**Exit codes**: `0` all captured and the gate passed; `1` any scenario
failed, any declared scenario is missing, the build failed, or the gate
failed; `2` usage error.

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
shots and diffs to the PR as evidence.

## Fixture

`fixtures/generate.mjs` writes, under `<root>/home`:

- 19 Claude Code projects (`.claude/projects/<encoded-cwd>/<uuid>.jsonl`) and
  6 Codex CLI projects (`.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`), each
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

- **Fonts**: external requests are blocked, so the Google-hosted IBM Plex Sans
  / JetBrains Mono never load and text renders in the system fallback.
  Deterministic on one machine; bundling the fonts locally is T4.
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
