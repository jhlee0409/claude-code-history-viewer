// Pixel comparison and the three gates.
//
//   reproducibility  same commit twice: every scenario byte-identical pixels
//                    (exact RGBA comparison, equal dimensions; pixelmatch's
//                    threshold and anti-alias filtering do not apply)
//   unchanged        no visual change intended: every scenario <= 0.1%
//                    pixelmatch-changed pixels. `expectChanged` (run.mjs
//                    --expect-changed; in CI the PR body's
//                    `ui-expected-changes:` line) names the scenarios a PR
//                    changes on purpose: those may exceed 0.1% and are
//                    reported as expected-change, every other scenario keeps
//                    the 0.1% rule
//   changed          intended visual change: a scenario with an approved
//                    baseline must match it (<= 0.1%); a scenario without one
//                    must stay within the unchanged tolerance (<= 0.1%) of the
//                    base, so tolerated noise never demands approval. Diff
//                    images vs the base are written for review either way
//
// In every mode a scenario that is missing on either side fails the gate.

import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { ExpectedChangesError, expectedBy, unmatchedPatterns } from "./expectedChanges.mjs";

export const PIXELMATCH_THRESHOLD = 0.1;
export const UNCHANGED_MAX_RATIO = 0.001; // 0.1%
export const GATES = ["reproducibility", "unchanged", "changed"];

export function comparePng(fileA, fileB, diffFile) {
  const a = PNG.sync.read(fs.readFileSync(fileA));
  const b = PNG.sync.read(fs.readFileSync(fileB));
  if (a.width !== b.width || a.height !== b.height) {
    return {
      sizeMismatch: true,
      size: [`${a.width}x${a.height}`, `${b.width}x${b.height}`],
      changedPixels: Math.max(a.width * a.height, b.width * b.height),
      changedRatio: 1,
      exactDifferentPixels: null,
    };
  }
  const { width, height } = a;
  let exactDifferentPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
      exactDifferentPixels += 1;
    }
  }
  const diff = new PNG({ width, height });
  const changedPixels = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: PIXELMATCH_THRESHOLD });
  if (diffFile && (changedPixels > 0 || exactDifferentPixels > 0)) {
    fs.mkdirSync(path.dirname(diffFile), { recursive: true });
    fs.writeFileSync(diffFile, PNG.sync.write(diff));
  }
  return {
    sizeMismatch: false,
    size: `${width}x${height}`,
    changedPixels,
    changedRatio: changedPixels / (width * height),
    exactDifferentPixels,
  };
}

const listPngs = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".png"))
        .map((name) => name.replace(/\.png$/, ""))
        .sort()
    : [];

/**
 * Compare head shots against base shots for `expected` scenario ids.
 * `declared` is every id the scenario file declares (before --only), so a
 * base shot outside it is a removed scenario while one merely filtered out
 * by --only is ignored. Returns { rows, ok, failures } - `ok` false = exit 1.
 */
const percent = (ratio) => `${(ratio * 100).toFixed(4)}%`;
const withinTolerance = (result) => !result.sizeMismatch && result.changedRatio <= UNCHANGED_MAX_RATIO;

/**
 * Per-gate verdict for one scenario's base-vs-head comparison: `row` fields
 * to merge into the report row, and a failure message when the gate fails.
 */
export const GATE_CHECKS = {
  reproducibility(result) {
    if (result.sizeMismatch) return { row: { status: "changed" }, failure: `size ${result.size.join(" vs ")} (reproducibility requires identical pixels)` };
    if (result.exactDifferentPixels !== 0) {
      return {
        row: { status: "changed" },
        failure: `${result.exactDifferentPixels} pixels differ exactly (${result.changedPixels} above the pixelmatch threshold); reproducibility requires 0`,
      };
    }
    return { row: {} };
  },
  unchanged(result, { expectedBy: entry } = {}) {
    if (withinTolerance(result)) return { row: {} };
    // Declared as intended (--expect-changed / the PR body): allowed, listed.
    if (entry) return { row: { status: "expected-change", expectedBy: entry } };
    return { row: { status: "changed" }, failure: `${percent(result.changedRatio)} changed (> 0.1%)` };
  },
  changed(result, { headFile, approvedDir, diffDir, id }) {
    const approved = approvedDir ? path.join(approvedDir, `${id}.png`) : null;
    if (!approved || !fs.existsSync(approved)) {
      // No intended change declared for this scenario: the unchanged
      // tolerance applies, and only a difference beyond it needs approval.
      if (withinTolerance(result)) return { row: { status: result.exactDifferentPixels === 0 ? "ok" : "within-tolerance" } };
      return {
        row: { status: "unapproved-change" },
        failure: `differs from base (${percent(result.changedRatio)} > 0.1%) and has no approved baseline in ${approvedDir}`,
      };
    }
    const vsApproved = comparePng(approved, headFile, path.join(diffDir, "vs-approved", `${id}.png`));
    if (withinTolerance(vsApproved)) return { row: { status: "approved-change", vsApproved } };
    return {
      row: { status: "differs-from-approved", vsApproved },
      failure: `${vsApproved.sizeMismatch ? "size differs" : percent(vsApproved.changedRatio)} off the approved baseline (> 0.1%)`,
    };
  },
};

/**
 * `expectChanged` entries (exact ids or `<prefix>*`) belong to the unchanged
 * gate, and each must cover a scenario of this comparison: a typo must fail,
 * not quietly declare nothing.
 */
function checkExpectChanged(gate, expectChanged, expected) {
  if (expectChanged.length === 0) return;
  if (gate !== "unchanged") throw new ExpectedChangesError(`expected changes apply to the unchanged gate only, not "${gate}"`);
  const unmatched = unmatchedPatterns(expectChanged, expected);
  if (unmatched.length) throw new ExpectedChangesError(`expected change(s) ${unmatched.join(", ")} match no scenario of this comparison`);
}

/**
 * A declared entry under which nothing changed beyond the tolerance: a stale
 * or mistaken declaration. Worth a warning, not a failure.
 */
function quietExpectations(expectChanged, rows) {
  const warnings = [];
  for (const entry of expectChanged) {
    const compared = rows.filter((row) => row.changedRatio !== undefined && expectedBy(row.id, [entry]));
    if (compared.length === 0 || compared.some((row) => row.status === "expected-change")) continue;
    const max = Math.max(...compared.map((row) => row.changedRatio));
    warnings.push(
      entry.endsWith("*")
        ? `${entry}: declared as an expected change, but none of its ${compared.length} scenario(s) changed more than 0.1% (max ${percent(max)})`
        : `${entry}: declared as an expected change, but changed ${percent(max)} (<= 0.1%)`,
    );
  }
  return warnings;
}

export function runGate({ gate, expected, declared = expected, headDir, baseDir, approvedDir, diffDir, expectChanged = [] }) {
  if (!GATES.includes(gate)) throw new Error(`unknown gate "${gate}" (expected ${GATES.join(", ")})`);
  checkExpectChanged(gate, expectChanged, expected);
  const head = new Set(listPngs(headDir));
  const base = new Set(listPngs(baseDir));
  const failures = [];
  const rows = [];

  // A base scenario the scenario file no longer declares was removed.
  for (const id of [...base].sort()) {
    if (!declared.includes(id)) failures.push(`${id}: present in base but not declared by this run (removed scenario?)`);
  }

  for (const id of expected) {
    const row = { id, status: "ok" };
    rows.push(row);
    if (!head.has(id)) {
      row.status = "missing-head";
      failures.push(`${id}: no capture in this run`);
      continue;
    }
    if (!base.has(id)) {
      row.status = "missing-base";
      failures.push(`${id}: no capture in base`);
      continue;
    }
    const result = comparePng(path.join(baseDir, `${id}.png`), path.join(headDir, `${id}.png`), path.join(diffDir, `${id}.png`));
    Object.assign(row, result);

    const verdict = GATE_CHECKS[gate](result, { headFile: path.join(headDir, `${id}.png`), approvedDir, diffDir, id, expectedBy: expectedBy(id, expectChanged) });
    Object.assign(row, verdict.row);
    if (verdict.failure) failures.push(`${id}: ${verdict.failure}`);
  }
  const expectedChanges = rows
    .filter((row) => row.status === "expected-change")
    .map((row) => ({ id: row.id, changedRatio: row.changedRatio, expectedBy: row.expectedBy }));
  return { gate, rows, failures, ok: failures.length === 0, expectChanged, expectedChanges, warnings: quietExpectations(expectChanged, rows) };
}

const section = (title, items) => (items.length ? ["", `${title} (${items.length}):`, ...items.map((item) => `- ${item}`)] : []);

/**
 * How to declare the scenarios that failed the unchanged gate. The key never
 * starts a line, so a report pasted into a PR body declares nothing.
 */
function declarationHint(gate, rows) {
  const changed = gate === "unchanged" ? rows.filter((row) => row.status === "changed").map((row) => row.id) : [];
  if (changed.length === 0) return [];
  return [
    "",
    "If these changes are intended, review the diff images, then declare them:",
    `  PR body (CI):  ui-expected-changes: ${changed.join(", ")}`,
    `  locally:       --expect-changed ${changed.join(",")}`,
  ];
}

export function formatReport({ gate, rows, failures, ok, baseLabel, headLabel, expectChanged = [], expectedChanges = [], warnings = [] }) {
  const expectedCount = expectedChanges.length ? `, ${expectedChanges.length} expected change${expectedChanges.length === 1 ? "" : "s"}` : "";
  const lines = [
    `# UI capture comparison - gate: ${gate}`,
    "",
    `base: ${baseLabel}`,
    `head: ${headLabel}`,
    `pixelmatch threshold ${PIXELMATCH_THRESHOLD}; unchanged/approved tolerance ${UNCHANGED_MAX_RATIO * 100}%`,
    ...(expectChanged.length ? [`expected changes (--expect-changed): ${expectChanged.join(", ")}`] : []),
    "",
    "| scenario | status | changed px | changed % | exact-diff px |",
    "|---|---|---:|---:|---:|",
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.status} | ${row.changedPixels ?? "-"} | ${row.changedRatio === undefined ? "-" : (row.changedRatio * 100).toFixed(4)} | ${row.exactDifferentPixels ?? "-"} |`,
    ),
    "",
    ok ? `PASS (${rows.length} scenarios${expectedCount})` : `FAIL (${failures.length} problem(s))`,
    ...failures.map((failure) => `- ${failure}`),
    ...section(
      "Expected changes",
      expectedChanges.map((change) => `${change.id}: ${percent(change.changedRatio)} changed${change.expectedBy === change.id ? "" : ` (${change.expectedBy})`}`),
    ),
    ...section("Warnings", warnings),
    ...declarationHint(gate, rows),
    "",
  ];
  return lines.join("\n");
}
