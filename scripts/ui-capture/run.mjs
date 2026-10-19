#!/usr/bin/env node
// Deterministic UI capture + measurement harness (task T0).
//
//   pnpm ui:capture                          capture every scenario
//   pnpm ui:capture --scenarios scripts/ui-capture/ci-scenarios.mjs   the CI subset
//   pnpm ui:capture --repro                  capture twice, gate reproducibility (0%)
//   pnpm ui:capture --base <ref|dir> [--gate reproducibility|unchanged|changed]
//   pnpm ui:capture --base <ref> --gate unchanged --expect-changed <id,prefix*>   intended changes
//   pnpm ui:capture --approve | --approve-from <run-dir>
//
// See scripts/ui-capture/README.md. Exit code 1 when any scenario fails to
// capture, a declared scenario is missing on either side, or the gate fails.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webkit } from "playwright";
import { generateFixture, snapshotTree } from "./fixtures/generate.mjs";
import { createActions } from "./lib/actions.mjs";
import { newScenarioPage, settle, screenshot } from "./lib/browser.mjs";
import { GATES, formatReport, runGate } from "./lib/compare.mjs";
import { ExpectedChangesError, expectedBy, parseExpectedList, unmatchedPatterns } from "./lib/expectedChanges.mjs";
import { SUPPORTED_LOCALES, loadTranslator } from "./lib/i18n.mjs";
import { checkMeasurementState, runProbes } from "./lib/probes.mjs";
import { populationFailures, runInnerProbes } from "./lib/innerProbes.mjs";
import { TYPOGRAPHY_PROBE, checkTypography } from "./lib/typography.mjs";
import { withServerAndBrowser } from "./lib/lifecycle.mjs";
import { splitByActivation } from "./lib/activation.mjs";
import { SelectionError, selectScenarios } from "./lib/selection.mjs";
import { VariantError, effectiveVariant, normalizeVariant, parseViewport, variantTag } from "./lib/variant.mjs";
import { startServer } from "./lib/server.mjs";
import { artifactModes, prepareArtifacts as prepareBuildArtifacts } from "./lib/artifacts.mjs";
import { exitAfterFlush } from "./lib/exit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT_ROOT = path.join(REPO, ".ui-capture");
const FIXTURE_ROOT = path.join(OUT_ROOT, "fixture");

class UsageError extends Error {}

// Order matters: the static probes read the captured view; motionActivity
// opens the first collapsed row, so it runs before the layout probes (which
// open every collapsed row); focusVisible moves focus, so it runs last.
const STATIC_INNER_PROBES = ["absPathLeaks", "toolRowMetrics", "wordBreak", "cjkLeading", "leftEdges", "overflowX", "cards", "chromeSelect", "motionActivity"];
const INTERACTIVE_INNER_PROBES = ["focusVisible"];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `usage: pnpm ui:capture [options]

  --repro                 capture twice on this commit and gate reproducibility (0%)
  --base <ref|dir>        compare against a git ref (built + captured in a temp
                          worktree, cached) or a directory of baseline PNGs / a run dir
  --gate <mode>           ${GATES.join(" | ")} (default: reproducibility)
  --expect-changed <ids>  with --gate unchanged: scenarios this change alters on
                          purpose (comma list of exact ids or <prefix>*); they
                          may exceed 0.1% and are reported as expected-change.
                          An entry matching no selected scenario is an error.
                          CI takes it from the PR body line
                          \`ui-expected-changes: <ids>\` (see README "Gates")
  --approved <dir>        approved baselines for --gate changed (default .ui-capture/approved)
  --approve               after capturing, copy this run's PNGs into the approved dir
  --approve-from <dir>    approve an existing run dir without capturing
  --only <a,b,...>        only scenarios whose id contains one of the substrings
  --scenarios <file>      alternative scenario module (default scripts/ui-capture/scenarios.mjs);
                          a module exporting SELECTED_IDS runs exactly those ids,
                          e.g. scripts/ui-capture/ci-scenarios.mjs (the PR gate)
  --list                  print the selected scenario ids and exit (no capture)
  --locale <code>         ${SUPPORTED_LOCALES.join(" | ")} (default: scenario file DEFAULT_LOCALE)
  --out <dir>             run directory (default .ui-capture/runs/<timestamp>-<sha>)
  --no-build              reuse the head build .ui-capture/build/{dist,cchv-server}
                          instead of building it; a --base <git-ref> is still
                          built into .ui-capture/build-base/<sha> when absent

  Variants (plan I0; recorded in the manifest, part of the base cache key):
  --forced-colors <m>     none | active   (Playwright forcedColors)
  --contrast <m>          no-preference | more
  --motion <m>            reduce (default) | full   (prefers-reduced-motion)
  --font-scale <f>        root font size factor, e.g. 1.25 (browser/OS text size)
  --timezone <zone>       IANA zone for the browser (default Asia/Seoul)
  --viewport <WxH>        capture the selected screens at this size instead
  --inspector <s>         open | closed: the stored inspector state
  --live                  live interaction mode: real clock, CSS motion not
                          suppressed (motion tests); never for pixel gates
  --help
`;

function parseArgs(argv) {
  const opts = { build: true, approve: false, repro: false, only: [], expectChanged: [], variant: {} };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--repro": opts.repro = true; break;
      case "--base": opts.base = value(i, arg); i += 1; break;
      case "--gate": opts.gate = value(i, arg); i += 1; break;
      case "--expect-changed": opts.expectChanged = expectChangedList(value(i, arg)); i += 1; break;
      case "--approved": opts.approved = path.resolve(value(i, arg)); i += 1; break;
      case "--approve": opts.approve = true; break;
      case "--approve-from": opts.approveFrom = path.resolve(value(i, arg)); i += 1; break;
      case "--only": opts.only = value(i, arg).split(",").filter(Boolean); i += 1; break;
      case "--scenarios": opts.scenarios = path.resolve(value(i, arg)); i += 1; break;
      case "--locale": opts.locale = value(i, arg); i += 1; break;
      case "--out": opts.out = path.resolve(value(i, arg)); i += 1; break;
      case "--no-build": opts.build = false; break;
      case "--forced-colors": opts.variant.forcedColors = value(i, arg); i += 1; break;
      case "--contrast": opts.variant.contrast = value(i, arg); i += 1; break;
      case "--motion": opts.variant.motion = value(i, arg); i += 1; break;
      case "--font-scale": opts.variant.fontScale = Number(value(i, arg)); i += 1; break;
      case "--timezone": opts.variant.timezone = value(i, arg); i += 1; break;
      case "--viewport": opts.variant.viewport = value(i, arg); i += 1; break;
      case "--inspector": opts.variant.inspector = value(i, arg); i += 1; break;
      case "--live": opts.variant.live = true; break;
      case "--list": opts.list = true; break;
      case "--help": case "-h": opts.help = true; break;
      default: throw new UsageError(`unknown option ${arg}`);
    }
  }
  if (opts.gate && !GATES.includes(opts.gate)) throw new UsageError(`--gate must be one of ${GATES.join(", ")}`);
  if (opts.gate && !opts.base) throw new UsageError("--gate needs --base (or use --repro)");
  if (opts.expectChanged.length && opts.gate !== "unchanged") throw new UsageError("--expect-changed applies to --gate unchanged only");
  if (opts.repro && opts.base) throw new UsageError("--repro and --base are exclusive");
  if (opts.locale && !SUPPORTED_LOCALES.includes(opts.locale)) throw new UsageError(`--locale must be one of ${SUPPORTED_LOCALES.join(", ")}`);
  try {
    normalizeVariant(opts.variant);
  } catch (error) {
    if (error instanceof VariantError) throw new UsageError(error.message);
    throw error;
  }
  if (opts.variant.live && (opts.repro || opts.base)) throw new UsageError("--live is for interaction tests; it cannot feed a pixel gate (--repro / --base)");
  opts.approved ??= path.join(OUT_ROOT, "approved");
  return opts;
}

/** `--expect-changed` value: at least one entry, each an id or `<prefix>*`. */
function expectChangedList(text) {
  let entries;
  try {
    entries = parseExpectedList(text);
  } catch (error) {
    if (error instanceof ExpectedChangesError) throw new UsageError(error.message);
    throw error;
  }
  if (entries.length === 0) throw new UsageError("--expect-changed needs at least one scenario id");
  return entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const git = (args, cwd = REPO) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function gitState(cwd = REPO) {
  const sha = git(["rev-parse", "HEAD"], cwd);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], cwd).length > 0;
  return { sha, dirty };
}

/** Content hash of the harness itself: a cached base is valid only for the harness that made it. */
function harnessDigest() {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (!name.endsWith(".md")) hash.update(`${path.relative(HERE, abs)}\0`).update(fs.readFileSync(abs)).update("\0");
    }
  };
  walk(HERE);
  return hash.digest("hex").slice(0, 16);
}

function runId(state) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${state.sha.slice(0, 7)}${state.dirty ? "-dirty" : ""}`;
}

async function loadScenarios(file) {
  const module = await import(pathToFileURL(file ?? path.join(HERE, "scenarios.mjs")).href);
  const expanded = module.expandScenarios(module.MATRIX);
  const ids = new Set();
  for (const scenario of expanded) {
    if (ids.has(scenario.id)) throw new UsageError(`duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
  }
  // Later-active scenarios (plan I0 (b)): declared with the task that turns
  // them on; never run, never part of a gate, always listed in the manifest.
  const { active: all, inactive } = splitByActivation(expanded);
  return {
    all,
    inactive,
    // An exact-id subset (lib/selection.mjs); null = every active scenario.
    selected: module.SELECTED_IDS ?? null,
    defaultLocale: module.DEFAULT_LOCALE ?? "ko",
    measurement: {
      state: module.MEASUREMENT_STATE ?? null,
      storageSeed: module.STORAGE_SEED ?? {},
      // --inspector open|closed seeds the stored inspector through the
      // scenario file's own helper.
      inspectorStorage: module.inspectorStorage ?? null,
    },
  };
}

/** `--viewport`: the selected screens at one size (ids follow the new size). */
function applyViewportVariant(scenarios, viewport) {
  if (!viewport) return scenarios;
  const vp = typeof viewport === "string" ? parseViewport(viewport) : viewport;
  const seen = new Set();
  const out = [];
  for (const scenario of scenarios) {
    const id = `${scenario.screen.id}--${vp.id}--${scenario.theme}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...scenario, id, viewport: vp, mobile: vp.width < 768 });
  }
  return out;
}

const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};

/** Caches the app writes into the data dirs it reads (not fixture content). */
const isAppCacheFile = (relPath) => path.basename(relPath) === ".session_cache.json";

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** build.sh for a checkout into dist + server binary (one shared cargo target dir). */
function runBuildScript({ appDir, dist, serverBin }) {
  console.log(`▸ building ${path.relative(REPO, appDir) || "."} -> ${path.relative(REPO, path.dirname(dist))}`);
  const result = spawnSync("bash", [path.join(HERE, "build.sh"), appDir, dist, serverBin, path.join(REPO, "src-tauri", "target")], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`build failed for ${appDir} (exit ${result.status})`);
}

/** Build (or reuse, see lib/artifacts.mjs) the dist + server binary for a checkout. */
const prepareArtifacts = ({ appDir, buildDir, mode }) =>
  prepareBuildArtifacts({ appDir, buildDir, mode, runBuild: runBuildScript, log: (m) => console.log(`▸ ${m.replace(REPO + path.sep, "")}`) });

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * `checkTypography`: fail a scenario whose typography is off (T4: lang, font
 * order, body line height, steps × scale, min font). On for this checkout's
 * captures; off for a --base capture, which is the "before" being compared.
 */
async function captureRun({ app, scenarios, declared, inactive = [], locale, measurement, runDir, label, variant = {}, checkTypography: enforceTypography = true }) {
  const shotsDir = path.join(runDir, "shots");
  const probesDir = path.join(runDir, "probes");
  const logsDir = path.join(runDir, "logs");
  // Only ever wipe our own output: a user-supplied --out outside .ui-capture
  // must be empty or absent.
  if (fs.existsSync(runDir)) {
    if (!runDir.startsWith(OUT_ROOT + path.sep) && fs.readdirSync(runDir).length > 0) {
      throw new UsageError(`refusing to overwrite non-empty ${runDir}`);
    }
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  fs.mkdirSync(shotsDir, { recursive: true });

  const fixture = generateFixture({ root: FIXTURE_ROOT });
  const fixtureBefore = snapshotTree(FIXTURE_ROOT, isAppCacheFile);
  const t = loadTranslator(app.appDir, locale);
  let serverArgs = null;
  const results = [];
  const started = Date.now();
  await withServerAndBrowser(
    {
      startServer: () =>
        startServer({
          binary: app.serverBin,
          dist: app.dist,
          home: fixture.home,
          fixtureRoot: FIXTURE_ROOT,
          logFile: path.join(runDir, "server.log"),
        }),
      launchBrowser: () => webkit.launch(),
    },
    async ({ server, browser }) => {
      serverArgs = server.args;
      console.log(`▸ capture [${label}] ${scenarios.length} scenarios, locale ${locale}, server ${server.origin}`);

      for (const [index, scenario] of scenarios.entries()) {
        const t0 = Date.now();
        const result = { id: scenario.id, ok: false };
        results.push(result);
        let session;
        try {
          const v = effectiveVariant(variant, scenario.screen.variant);
          const inspectorSeed = v.inspector && measurement.inspectorStorage ? measurement.inspectorStorage({ open: v.inspector === "open" }) : {};
          session = await newScenarioPage(browser, {
            scenario,
            origin: server.origin,
            locale,
            fixedNow: fixture.fixedNow,
            injections: scenario.screen.inject,
            storageSeed: { ...measurement.storageSeed, ...(scenario.screen.storage ?? {}), ...inspectorSeed },
            variant: v,
          });
          await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
          const mode = scenario.screen.settle ?? "ready";
          let settled = await settle(session, { mode, label: "initial load" });
          const runStep = createActions({ session, scenario, manifest: fixture, t });
          for (const step of scenario.screen.steps ?? []) {
            await runStep(step);
          }
          settled = await settle(session, { mode, label: "before capture" });
          await screenshot(session.page, path.join(shotsDir, `${scenario.id}.png`));
          // Inner-UI probes (plan I0): see STATIC_INNER_PROBES for the order.
          const probeCtx = { screen: scenario.screen.id, locale, mobile: scenario.mobile, theme: scenario.theme, viewport: scenario.viewport.id, live: v.live };
          const inner = await runInnerProbes(session.page, probeCtx, { only: STATIC_INNER_PROBES });
          const probes = await runProbes(session.page, { live: v.live });
          Object.assign(inner, await runInnerProbes(session.page, probeCtx, { only: INTERACTIVE_INNER_PROBES }));
          const emptyPopulations = populationFailures(inner);
          // Undo what the steps wrote to the shared fixture (a favourite),
          // so later scenarios start from the same data.
          for (const step of scenario.screen.cleanup ?? []) {
            await runStep(step);
          }
          const expectedState = measurement.state && {
            ...measurement.state,
            fontScalePercent: scenario.screen.fontScalePercent ?? measurement.state.fontScalePercent,
            tabs: scenario.screen.tabs ?? measurement.state.tabs,
            inspectorOpen: v.inspector ? v.inspector === "open" : (scenario.screen.inspectorOpen ?? measurement.state.inspectorOpen),
            rootFontSizePx: 16 * v.fontScale,
          };
          const stateProblems = expectedState
            ? checkMeasurementState(probes.measurementState, expectedState, { mobile: scenario.mobile })
            : [];
          const typography = await session.page.evaluate(TYPOGRAPHY_PROBE);
          typography.problems = checkTypography(typography, {
            locale,
            scalePercent: expectedState?.fontScalePercent ?? 100,
            rootScale: v.fontScale, // browser/OS text size (--font-scale)
            minFontPx: probes.minFontSize.px,
          });
          writeJson(path.join(probesDir, `${scenario.id}.json`), {
            scenario: scenario.id,
            screen: scenario.screen.id,
            viewport: { width: scenario.viewport.width, height: scenario.viewport.height, deviceScaleFactor: 2 },
            theme: scenario.theme,
            locale,
            variant: v,
            ...probes,
            typography,
            inner,
          });
          if (stateProblems.length) throw new Error(`measurement state: ${stateProblems.join("; ")}`);
          if (enforceTypography && typography.problems.length) throw new Error(`typography: ${typography.problems.join("; ")}`);
          // An applicable probe that judged nothing proves nothing (plan I0).
          if (enforceTypography && emptyPopulations.length) throw new Error(`probes: ${emptyPopulations.join("; ")}`);
          result.ok = true;
          result.readyMarker = settled.readyMarker;
        } catch (error) {
          result.error = String(error?.message ?? error).split("\n")[0];
          // A failed scenario must not leave a stale or partial shot behind.
          fs.rmSync(path.join(shotsDir, `${scenario.id}.png`), { force: true });
        } finally {
          if (session) {
            writeJson(path.join(logsDir, `${scenario.id}.json`), {
              blockedRequests: [...new Set(session.log.blockedRequests)],
              injected: session.log.injected,
              consoleErrors: session.log.consoleErrors,
              pageErrors: session.log.pageErrors,
            });
            await session.close().catch(() => {});
          }
          result.ms = Date.now() - t0;
        }
        const tag = result.ok ? "ok  " : "FAIL";
        console.log(
          `  [${String(index + 1).padStart(3)}/${scenarios.length}] ${tag} ${scenario.id.padEnd(34)} ${(result.ms / 1000).toFixed(1)}s${result.error ? `  ${result.error}` : ""}`,
        );
      }
    },
  );

  const fixtureAfter = snapshotTree(FIXTURE_ROOT, isAppCacheFile);
  const fixtureChanges = [...new Set([...Object.keys(fixtureBefore.files), ...Object.keys(fixtureAfter.files)])]
    .filter((file) => fixtureBefore.files[file] !== fixtureAfter.files[file])
    .sort();
  const failures = results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error}`);
  // Every selected scenario must have produced a shot.
  for (const scenario of scenarios) {
    if (!fs.existsSync(path.join(shotsDir, `${scenario.id}.png`)) && !failures.some((f) => f.startsWith(`${scenario.id}:`))) {
      failures.push(`${scenario.id}: no capture produced`);
    }
  }
  const allProbes = {};
  for (const scenario of scenarios) {
    const file = path.join(probesDir, `${scenario.id}.json`);
    if (fs.existsSync(file)) allProbes[scenario.id] = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  writeJson(path.join(runDir, "probes.json"), allProbes);
  writeJson(path.join(runDir, "manifest.json"), {
    label,
    harness: harnessDigest(),
    git: gitState(app.appDir),
    appDir: app.appDir,
    locale,
    fixedNow: fixture.fixedNow,
    fixture: {
      version: fixture.fixtureVersion,
      digest: fixture.digest,
      // Files the app changed during the run, besides its own caches.
      changedByRun: fixtureChanges,
    },
    versions: { node: process.version, playwright: playwrightVersion(), webkit: browserVersion },
    server: { args: serverArgs },
    variant: normalizeVariant(variant),
    declared,
    // Later-active scenarios (plan I0 (b)): not run, owner task named.
    inactive,
    scenarios: results,
    durationMs: Date.now() - started,
  });
  if (fixtureChanges.length > 0) {
    console.log(`  ! the app changed fixture files during the run: ${fixtureChanges.join(", ")}`);
  }
  return { runDir, shotsDir, failures, results };
}

let browserVersion = null;
function playwrightVersion() {
  return JSON.parse(fs.readFileSync(path.join(REPO, "node_modules", "playwright", "package.json"), "utf8")).version;
}

// ---------------------------------------------------------------------------
// Base resolution
// ---------------------------------------------------------------------------

/**
 * Shots of a run dir (`shots/`), of a --repro run dir (`run-1/shots/`), or a
 * plain directory of PNGs, plus the manifest next to them when there is one.
 */
function locateShots(dir) {
  for (const candidate of [dir, path.join(dir, "run-1")]) {
    if (fs.existsSync(path.join(candidate, "shots"))) {
      const manifestFile = path.join(candidate, "manifest.json");
      const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
      return { shotsDir: path.join(candidate, "shots"), manifest };
    }
  }
  return { shotsDir: dir, manifest: null };
}

/** A directory of PNGs (or a run dir) is used as-is; anything else is a git ref. */
async function resolveBase({ base, scenarios, declared, locale, measurement, buildMode, variant = {} }) {
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const dir = path.resolve(base);
    const { shotsDir, manifest } = locateShots(dir);
    if (manifest && manifest.locale !== locale) {
      throw new UsageError(`base was captured with locale ${manifest.locale}, this run uses ${locale}`);
    }
    return { label: shotsDir, shotsDir, failures: [] };
  }

  let sha;
  try {
    sha = git(["rev-parse", "--verify", `${base}^{commit}`]);
  } catch {
    throw new UsageError(`--base ${base}: neither a directory nor a git ref`);
  }
  const tag = variantTag(variant);
  const key = `${sha.slice(0, 12)}-${locale}-${harnessDigest()}${tag ? `-${tag}` : ""}`;
  const cacheDir = path.join(OUT_ROOT, "baselines", key);
  const cached = path.join(cacheDir, "manifest.json");
  if (fs.existsSync(cached)) {
    const manifest = JSON.parse(fs.readFileSync(cached, "utf8"));
    const have = new Set(manifest.scenarios.filter((s) => s.ok).map((s) => s.id));
    if (scenarios.every((s) => have.has(s.id))) {
      console.log(`▸ base ${base} (${sha.slice(0, 12)}): cached captures ${path.relative(REPO, cacheDir)}`);
      return { label: `${base} (${sha.slice(0, 12)})`, shotsDir: path.join(cacheDir, "shots"), failures: [] };
    }
  }

  // Build and capture the base in a temporary worktree with *this* harness.
  const worktree = path.join(os.tmpdir(), `cchv-ui-capture-${sha.slice(0, 12)}`);
  const dropWorktree = () => {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO, stdio: "ignore" });
    fs.rmSync(worktree, { recursive: true, force: true });
    spawnSync("git", ["worktree", "prune"], { cwd: REPO, stdio: "ignore" });
  };
  dropWorktree(); // a leftover of an interrupted run
  try {
    // Inside the try: a partially created worktree is removed as well.
    git(["worktree", "add", "--detach", worktree, sha]);
    const app = prepareArtifacts({ appDir: worktree, buildDir: path.join(OUT_ROOT, "build-base", sha.slice(0, 12)), mode: buildMode });
    const run = await captureRun({
      app,
      scenarios,
      declared,
      locale,
      measurement,
      variant,
      runDir: cacheDir,
      label: `base ${sha.slice(0, 12)}`,
      checkTypography: false,
    });
    return { label: `${base} (${sha.slice(0, 12)})`, shotsDir: run.shotsDir, failures: run.failures.map((f) => `base ${f}`) };
  } finally {
    dropWorktree();
  }
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

function approve({ fromDir, approvedDir, only }) {
  const { shotsDir, manifest } = locateShots(fromDir);
  const names = fs.readdirSync(shotsDir).filter((n) => n.endsWith(".png") && (only.length === 0 || only.some((o) => n.includes(o))));
  if (names.length === 0) throw new UsageError(`nothing to approve in ${shotsDir}`);
  fs.mkdirSync(approvedDir, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(shotsDir, name), path.join(approvedDir, name));
  writeJson(path.join(approvedDir, "approved.json"), {
    from: shotsDir,
    git: manifest?.git ?? null,
    scenarios: names.map((n) => n.replace(/\.png$/, "")),
  });
  console.log(`▸ approved ${names.length} baseline(s) into ${path.relative(REPO, approvedDir)}`);
}

// ---------------------------------------------------------------------------
// One run at a time: every run regenerates and serves .ui-capture/fixture.
// ---------------------------------------------------------------------------

function acquireLock() {
  const lockFile = path.join(OUT_ROOT, "run.lock");
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(lockFile, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (probeError) {
      alive = probeError.code === "EPERM";
    }
    if (alive && pid !== process.pid) {
      throw new UsageError(`another ui:capture run (pid ${pid}) is using ${path.relative(REPO, OUT_ROOT)}`);
    }
    fs.writeFileSync(lockFile, String(process.pid)); // stale lock of a killed run
  }
  process.on("exit", () => {
    try {
      if (fs.readFileSync(lockFile, "utf8") === String(process.pid)) fs.rmSync(lockFile);
    } catch {
      // already gone
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.approveFrom) {
    approve({ fromDir: opts.approveFrom, approvedDir: opts.approved, only: opts.only });
    return 0;
  }

  const loaded = await loadScenarios(opts.scenarios);
  const { defaultLocale, measurement, inactive } = loaded;
  const all = applyViewportVariant(loaded.all, opts.variant.viewport);
  // `declared` stays the whole matrix under a SELECTED_IDS subset too, so a
  // base cache holding the full matrix is not mistaken for removed scenarios.
  const declared = all.map((s) => s.id);
  let pool = all;
  if (loaded.selected) {
    try {
      pool = applyViewportVariant(selectScenarios(loaded.all, loaded.selected), opts.variant.viewport);
    } catch (error) {
      if (error instanceof SelectionError) throw new UsageError(`${path.relative(REPO, opts.scenarios)}: ${error.message}`);
      throw error;
    }
  }
  const scenarios = opts.only.length ? pool.filter((s) => opts.only.some((o) => s.id.includes(o))) : pool;
  if (scenarios.length === 0) throw new UsageError(`--only ${opts.only.join(",")} matches no scenario`);
  // Before anything is built or captured, so a typo fails at once.
  const unmatched = unmatchedPatterns(opts.expectChanged, scenarios.map((s) => s.id));
  if (unmatched.length) throw new UsageError(`--expect-changed ${unmatched.join(", ")} matches no selected scenario (--list prints them)`);
  if (opts.list) {
    for (const scenario of scenarios) console.log(scenario.id);
    return 0;
  }
  if (opts.expectChanged.length) {
    const covered = scenarios.filter((s) => expectedBy(s.id, opts.expectChanged)).map((s) => s.id);
    console.log(`▸ expected changes (--expect-changed ${opts.expectChanged.join(",")}): ${covered.length} scenario(s) may exceed 0.1%: ${covered.join(", ")}`);
  }
  if (inactive.length) {
    const owners = [...new Set(inactive.map((s) => s.activatesWith))].sort();
    console.log(`▸ ${inactive.length} later-active scenario(s) not run (inactive until ${owners.join(", ")}); listed in manifest.json → inactive`);
  }
  if (loaded.selected) console.log(`▸ ${pool.length} of ${all.length} scenarios selected by ${path.relative(REPO, opts.scenarios)} (SELECTED_IDS)`);
  const locale = opts.locale ?? defaultLocale;
  acquireLock();

  const probe = await webkit.launch();
  try {
    browserVersion = probe.version();
  } finally {
    await probe.close();
  }

  const state = gitState();
  const tag = variantTag(opts.variant);
  const id = `${runId(state)}${tag ? `-${tag}` : ""}`;
  const runDir = opts.out ?? path.join(OUT_ROOT, "runs", id);
  const modes = artifactModes({ build: opts.build });
  const head = prepareArtifacts({ appDir: REPO, buildDir: path.join(OUT_ROOT, "build"), mode: modes.head });

  const failures = [];
  let comparison = null;
  let gateNotes = "";

  if (opts.repro) {
    const first = await captureRun({ app: head, scenarios, declared, inactive, locale, measurement, variant: opts.variant, runDir: path.join(runDir, "run-1"), label: "repro run 1" });
    const second = await captureRun({ app: head, scenarios, declared, inactive, locale, measurement, variant: opts.variant, runDir: path.join(runDir, "run-2"), label: "repro run 2" });
    failures.push(...first.failures.map((f) => `run 1 ${f}`), ...second.failures.map((f) => `run 2 ${f}`));
    comparison = { gate: "reproducibility", baseLabel: first.runDir, headLabel: second.runDir, baseDir: first.shotsDir, headDir: second.shotsDir };
  } else {
    const run = await captureRun({ app: head, scenarios, declared, inactive, locale, measurement, variant: opts.variant, runDir, label: "head" });
    failures.push(...run.failures);
    if (opts.base) {
      const base = await resolveBase({ base: opts.base, scenarios, declared, locale, measurement, buildMode: modes.base, variant: opts.variant });
      failures.push(...base.failures);
      comparison = { gate: opts.gate ?? "reproducibility", baseLabel: base.label, headLabel: run.runDir, baseDir: base.shotsDir, headDir: run.shotsDir };
    }
    if (opts.approve) approve({ fromDir: runDir, approvedDir: opts.approved, only: opts.only });
  }

  if (comparison) {
    const outcome = runGate({
      gate: comparison.gate,
      expected: scenarios.map((s) => s.id),
      declared,
      headDir: comparison.headDir,
      baseDir: comparison.baseDir,
      approvedDir: opts.approved,
      diffDir: path.join(runDir, "compare", "diff"),
      expectChanged: opts.expectChanged,
    });
    const report = formatReport({ ...outcome, baseLabel: comparison.baseLabel, headLabel: comparison.headLabel });
    fs.mkdirSync(path.join(runDir, "compare"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "compare", "report.md"), report);
    writeJson(path.join(runDir, "compare", "report.json"), { ...outcome, base: comparison.baseLabel, head: comparison.headLabel });
    console.log(`\n${report}`);
    failures.push(...outcome.failures.map((f) => `gate ${comparison.gate}: ${f}`));
    const notes = [];
    if (outcome.expectedChanges.length) notes.push(`${outcome.expectedChanges.length} expected change(s)`);
    if (outcome.warnings.length) notes.push(`${outcome.warnings.length} warning(s)`);
    if (notes.length) gateNotes = ` (${notes.join(", ")}; see the report above)`;
  }

  fs.mkdirSync(path.join(OUT_ROOT, "runs"), { recursive: true });
  const latest = path.join(OUT_ROOT, "runs", "latest");
  fs.rmSync(latest, { force: true });
  if (runDir.startsWith(path.join(OUT_ROOT, "runs"))) fs.symlinkSync(path.basename(runDir), latest);

  console.log(`\n▸ run dir: ${path.relative(REPO, runDir)}`);
  if (failures.length) {
    console.log(`✗ ${failures.length} failure(s):`);
    for (const failure of failures) console.log(`  - ${failure}`);
    return 1;
  }
  console.log(`✓ ${scenarios.length} scenarios captured${comparison ? `, gate ${comparison.gate} passed${gateNotes}` : ""}`);
  return 0;
}

main().then(
  exitAfterFlush,
  (error) => {
    console.error(`✗ ${error?.message ?? error}`);
    exitAfterFlush(error instanceof UsageError ? 2 : 1);
  },
);
