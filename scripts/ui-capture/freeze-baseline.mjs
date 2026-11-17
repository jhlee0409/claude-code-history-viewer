#!/usr/bin/env node
// Freeze the inner-UI "before" baseline (plan I0) from measured runs:
//
//   node scripts/ui-capture/freeze-baseline.mjs \
//     --run .ui-capture/runs/<repro>/run-1  [--run <font-scale 1.25 run> ...] \
//     --repro-report .ui-capture/runs/<repro>/compare/report.json \
//     --states .ui-capture/states/latest/summary.json \
//     [--motion <--live run dir>] \
//     --out specs/2026-10-18-inner-ui/baseline.json
//
// Re-freeze one probe after a probe fix (the rest stays as frozen):
//
//   node scripts/ui-capture/freeze-baseline.mjs --update-probe leftEdges \
//     --run <run dir> --reason "<why>" --out specs/2026-10-18-inner-ui/baseline.json
//
// Writes numbers only from the given runs (never estimates); D metrics no I0
// probe measures are listed with the task/test that measures them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateBefore, replaceProbe, scrubPaths } from "./lib/baseline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

function parseArgs(argv) {
  const opts = { runs: [], motion: [], updateProbes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[(i += 1)];
    if (argv[i] === "--run") opts.runs.push(path.resolve(next()));
    else if (argv[i] === "--repro-report") opts.repro = path.resolve(next());
    else if (argv[i] === "--states") opts.states = path.resolve(next());
    else if (argv[i] === "--motion") opts.motion.push(path.resolve(next()));
    else if (argv[i] === "--out") opts.out = path.resolve(next());
    else if (argv[i] === "--update-probe") opts.updateProbes.push(next());
    else if (argv[i] === "--reason") opts.reason = next();
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!opts.runs.length || !opts.out) throw new Error("usage: freeze-baseline.mjs --run <dir> [--run <dir>] --repro-report <json> --states <json> [--motion <dir>] --out <file>");
  if (opts.updateProbes.length && !opts.reason) throw new Error("--update-probe needs --reason (recorded in the baseline)");
  return opts;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const NOT_PROBED = {
  D3: "toolOutcome verdict table (TR0) + transcript-failure/-unknown-outcome captures",
  D4: "DOM order test + Edit row → diff distance probe (TR2a) on x-transcript-edit-expanded",
  D5: "DiffView unit tests + CVD simulation (TR2a/TR2b)",
  D6: "OutputBlock unit test (TR0)",
  D8: "motion.reduce.test.mjs in --live (F1b); I0 records motionActivity below when --motion is given",
  D9: "designTokens guard motion category (I0b)",
  D10: "forcedColors computed-style test (F1b/F2a)",
  D11: "contrast.more test (F1b)",
  D13: "designTokens guard (I0b) - exact fingerprint baseline",
  D14: "designTokens guard negative tests (I0b)",
  D15: "format module guard + unit tests (F3b)",
  D16: "i18n:validate plural rules + pluralRender.test.ts (F4a)",
  D17: "placeNames.invariant (F4a)",
  D18: "state-matrix tests and captures (SX0/SX1)",
  D19: "usage-breakdown reconciliation tests (AN0a/AN0b)",
  D21: "restore refusal tests (EV0) + Edits captures (ED1)",
  D22: "AX tree / axe checks (TR3, A11Y1)",
  D23: "regionNav.keyboard (A11Y1)",
  D26: "journey-evidence (EV2, later-active)",
  D27: "independent re-score (Q1), editorial",
  D28: "designTokens guard decoration category (I0b)",
};

/**
 * --update-probe: replace only the named probes' before-values (per font
 * scale of the given runs) in the existing --out baseline, and record the
 * re-measurement (run, revision, harness, reason) next to them.
 */
function updateProbes(opts, runs, roots) {
  const baseline = readJson(opts.out);
  baseline.remeasured ??= [];
  for (const run of runs) {
    const scale = `${Math.round((run.manifest.variant?.fontScale ?? 1) * 100)}%`;
    const frozen = baseline.before[scale];
    if (!frozen) throw new Error(`the baseline has no ${scale} before-values to update`);
    for (const probe of opts.updateProbes) {
      const { before, replaced } = replaceProbe(frozen.before, aggregateBefore(run.probes), probe);
      frozen.before = before;
      baseline.remeasured.push({
        probe,
        fontScale: scale,
        replaced,
        run: path.relative(REPO, run.dir),
        revision: { sha: run.manifest.git.sha, dirty: run.manifest.git.dirty, harnessDigest: run.manifest.harness },
        reason: opts.reason,
      });
      console.log(`▸ ${scale}: re-froze ${replaced.join(", ")} from ${path.relative(REPO, run.dir)}`);
    }
  }
  fs.writeFileSync(opts.out, JSON.stringify(scrubPaths(baseline, roots), null, 2) + "\n");
  console.log(`▸ wrote ${path.relative(REPO, opts.out)}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const roots = [[REPO, "<repo>"], [os.homedir(), "~"]];
  const runs = opts.runs.map((dir) => ({ dir, manifest: readJson(path.join(dir, "manifest.json")), probes: readJson(path.join(dir, "probes.json")) }));
  if (opts.updateProbes.length) return updateProbes(opts, runs, roots);
  const head = runs[0].manifest;
  const byScale = {};
  for (const run of runs) {
    const scale = run.manifest.variant?.fontScale ?? 1;
    byScale[`${Math.round(scale * 100)}%`] = { run: path.relative(REPO, run.dir), variant: run.manifest.variant, scenarios: Object.keys(run.probes).length, before: aggregateBefore(run.probes) };
  }
  const states = opts.states ? readJson(opts.states) : null;
  const repro = opts.repro ? readJson(opts.repro) : null;
  // --live runs (one per --motion dir): motionActivity per scenario and motion preference.
  const motion = opts.motion.length ? {} : null;
  for (const dir of opts.motion) {
    const probes = readJson(path.join(dir, "probes.json"));
    for (const [id, p] of Object.entries(probes)) {
      motion[`${id} [prefers-reduced-motion: ${p.variant?.motion === "full" ? "no-preference" : "reduce"}]`] = { run: path.relative(REPO, dir), motionActivity: p.inner?.motionActivity ?? null };
    }
  }
  const verify = JSON.parse(sh(process.execPath, [path.join(HERE, "fixtures", "generate.mjs"), "--verify"]) ?? "null");
  const baseline = {
    $comment: "Inner-UI plan I0 baseline freeze: measured values only. Regenerate with scripts/ui-capture/freeze-baseline.mjs; see scripts/ui-capture/README.md.",
    revision: { sha: head.git.sha, dirty: head.git.dirty, harnessDigest: head.harness },
    fixture: {
      version: head.fixture.version,
      // At this checkout's .ui-capture/fixture; the digest also depends on
      // the root path's sort position (as on develop), so --verify (two temp
      // roots + the same root twice) is the reproducibility proof.
      digest: head.fixture.digest,
      verify: verify && { reproducible: verify.reproducible, manifestDigest: verify.manifestDigest },
    },
    engines: {
      node: head.versions.node,
      playwright: head.versions.playwright,
      webkit: head.versions.webkit,
      chromium: states?.engines?.chromium ?? null,
    },
    machine: {
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      model: sh("sysctl", ["-n", "hw.model"]),
      // The host name is left out on purpose (it carries a person's name).
    },
    locale: head.locale,
    fixedNow: head.fixedNow,
    fontScales: Object.keys(byScale),
    reproducibility: repro && {
      gate: repro.gate,
      scenarios: repro.rows?.length ?? null,
      failures: repro.failures ?? [],
      maxExactDiffPx: Math.max(0, ...(repro.rows ?? []).map((r) => r.exactDifferentPixels ?? 0)),
    },
    inactiveScenarios: head.inactive ?? [],
    before: byScale,
    statesGallery: states,
    motionLive: motion,
    notMeasuredByI0Probes: NOT_PROBED,
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(scrubPaths(baseline, roots), null, 2) + "\n");
  console.log(`▸ wrote ${path.relative(REPO, opts.out)}`);
}

main();
