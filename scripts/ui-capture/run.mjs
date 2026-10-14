#!/usr/bin/env node
// Deterministic UI capture + measurement harness (task T0).
//
//   pnpm ui:capture                          capture every scenario
//   pnpm ui:capture --repro                  capture twice, gate reproducibility (0%)
//   pnpm ui:capture --base <ref|dir> [--gate reproducibility|unchanged|changed]
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
import { SUPPORTED_LOCALES, loadTranslator } from "./lib/i18n.mjs";
import { checkMeasurementState, runProbes } from "./lib/probes.mjs";
import { withServerAndBrowser } from "./lib/lifecycle.mjs";
import { startServer } from "./lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT_ROOT = path.join(REPO, ".ui-capture");
const FIXTURE_ROOT = path.join(OUT_ROOT, "fixture");

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `usage: pnpm ui:capture [options]

  --repro                 capture twice on this commit and gate reproducibility (0%)
  --base <ref|dir>        compare against a git ref (built + captured in a temp
                          worktree, cached) or a directory of baseline PNGs / a run dir
  --gate <mode>           ${GATES.join(" | ")} (default: reproducibility)
  --approved <dir>        approved baselines for --gate changed (default .ui-capture/approved)
  --approve               after capturing, copy this run's PNGs into the approved dir
  --approve-from <dir>    approve an existing run dir without capturing
  --only <a,b,...>        only scenarios whose id contains one of the substrings
  --scenarios <file>      alternative scenario module (default scripts/ui-capture/scenarios.mjs)
  --locale <code>         ${SUPPORTED_LOCALES.join(" | ")} (default: scenario file DEFAULT_LOCALE)
  --out <dir>             run directory (default .ui-capture/runs/<timestamp>-<sha>)
  --no-build              reuse .ui-capture/build/{dist,cchv-server} instead of building
  --help
`;

function parseArgs(argv) {
  const opts = { build: true, approve: false, repro: false, only: [] };
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
      case "--approved": opts.approved = path.resolve(value(i, arg)); i += 1; break;
      case "--approve": opts.approve = true; break;
      case "--approve-from": opts.approveFrom = path.resolve(value(i, arg)); i += 1; break;
      case "--only": opts.only = value(i, arg).split(",").filter(Boolean); i += 1; break;
      case "--scenarios": opts.scenarios = path.resolve(value(i, arg)); i += 1; break;
      case "--locale": opts.locale = value(i, arg); i += 1; break;
      case "--out": opts.out = path.resolve(value(i, arg)); i += 1; break;
      case "--no-build": opts.build = false; break;
      case "--help": case "-h": opts.help = true; break;
      default: throw new UsageError(`unknown option ${arg}`);
    }
  }
  if (opts.gate && !GATES.includes(opts.gate)) throw new UsageError(`--gate must be one of ${GATES.join(", ")}`);
  if (opts.gate && !opts.base) throw new UsageError("--gate needs --base (or use --repro)");
  if (opts.repro && opts.base) throw new UsageError("--repro and --base are exclusive");
  if (opts.locale && !SUPPORTED_LOCALES.includes(opts.locale)) throw new UsageError(`--locale must be one of ${SUPPORTED_LOCALES.join(", ")}`);
  opts.approved ??= path.join(OUT_ROOT, "approved");
  return opts;
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
  const all = module.expandScenarios(module.MATRIX);
  const ids = new Set();
  for (const scenario of all) {
    if (ids.has(scenario.id)) throw new UsageError(`duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
  }
  return {
    all,
    defaultLocale: module.DEFAULT_LOCALE ?? "ko",
    measurement: { state: module.MEASUREMENT_STATE ?? null, storageSeed: module.STORAGE_SEED ?? {} },
  };
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

/** Build (or reuse) the dist + server binary for a checkout. */
function prepareArtifacts({ appDir, buildDir, build }) {
  const dist = path.join(buildDir, "dist");
  const serverBin = path.join(buildDir, "cchv-server");
  if (build) {
    console.log(`▸ building ${path.relative(REPO, appDir) || "."} -> ${path.relative(REPO, buildDir)}`);
    const result = spawnSync("bash", [path.join(HERE, "build.sh"), appDir, dist, serverBin, path.join(REPO, "src-tauri", "target")], {
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`build failed for ${appDir} (exit ${result.status})`);
  }
  for (const required of [path.join(dist, "index.html"), serverBin]) {
    if (!fs.existsSync(required)) throw new Error(`missing build artifact ${required} (drop --no-build)`);
  }
  return { appDir, dist, serverBin };
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function captureRun({ app, scenarios, declared, locale, measurement, runDir, label }) {
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
          session = await newScenarioPage(browser, {
            scenario,
            origin: server.origin,
            locale,
            fixedNow: fixture.fixedNow,
            injections: scenario.screen.inject,
            storageSeed: measurement.storageSeed,
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
          const probes = await runProbes(session.page);
          const stateProblems = measurement.state
            ? checkMeasurementState(probes.measurementState, measurement.state, { mobile: scenario.mobile })
            : [];
          writeJson(path.join(probesDir, `${scenario.id}.json`), {
            scenario: scenario.id,
            screen: scenario.screen.id,
            viewport: { width: scenario.viewport.width, height: scenario.viewport.height, deviceScaleFactor: 2 },
            theme: scenario.theme,
            locale,
            ...probes,
          });
          if (stateProblems.length) throw new Error(`measurement state: ${stateProblems.join("; ")}`);
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
    declared,
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
async function resolveBase({ base, scenarios, declared, locale, measurement, build }) {
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
  const key = `${sha.slice(0, 12)}-${locale}-${harnessDigest()}`;
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
    const app = prepareArtifacts({ appDir: worktree, buildDir: path.join(OUT_ROOT, "build-base", sha.slice(0, 12)), build });
    const run = await captureRun({ app, scenarios, declared, locale, measurement, runDir: cacheDir, label: `base ${sha.slice(0, 12)}` });
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

  const { all, defaultLocale, measurement } = await loadScenarios(opts.scenarios);
  const declared = all.map((s) => s.id);
  const scenarios = opts.only.length ? all.filter((s) => opts.only.some((o) => s.id.includes(o))) : all;
  if (scenarios.length === 0) throw new UsageError(`--only ${opts.only.join(",")} matches no scenario`);
  const locale = opts.locale ?? defaultLocale;
  acquireLock();

  const probe = await webkit.launch();
  try {
    browserVersion = probe.version();
  } finally {
    await probe.close();
  }

  const state = gitState();
  const id = runId(state);
  const runDir = opts.out ?? path.join(OUT_ROOT, "runs", id);
  const head = prepareArtifacts({ appDir: REPO, buildDir: path.join(OUT_ROOT, "build"), build: opts.build });

  const failures = [];
  let comparison = null;

  if (opts.repro) {
    const first = await captureRun({ app: head, scenarios, declared, locale, measurement, runDir: path.join(runDir, "run-1"), label: "repro run 1" });
    const second = await captureRun({ app: head, scenarios, declared, locale, measurement, runDir: path.join(runDir, "run-2"), label: "repro run 2" });
    failures.push(...first.failures.map((f) => `run 1 ${f}`), ...second.failures.map((f) => `run 2 ${f}`));
    comparison = { gate: "reproducibility", baseLabel: first.runDir, headLabel: second.runDir, baseDir: first.shotsDir, headDir: second.shotsDir };
  } else {
    const run = await captureRun({ app: head, scenarios, declared, locale, measurement, runDir, label: "head" });
    failures.push(...run.failures);
    if (opts.base) {
      const base = await resolveBase({ base: opts.base, scenarios, declared, locale, measurement, build: opts.build });
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
    });
    const report = formatReport({ ...outcome, baseLabel: comparison.baseLabel, headLabel: comparison.headLabel });
    fs.mkdirSync(path.join(runDir, "compare"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "compare", "report.md"), report);
    writeJson(path.join(runDir, "compare", "report.json"), { ...outcome, base: comparison.baseLabel, head: comparison.headLabel });
    console.log(`\n${report}`);
    failures.push(...outcome.failures.map((f) => `gate ${comparison.gate}: ${f}`));
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
  console.log(`✓ ${scenarios.length} scenarios captured${comparison ? `, gate ${comparison.gate} passed` : ""}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`✗ ${error?.message ?? error}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  },
);
