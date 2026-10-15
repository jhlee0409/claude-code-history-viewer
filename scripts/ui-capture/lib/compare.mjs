// Pixel comparison and the three gates.
//
//   reproducibility  same commit twice: every scenario byte-identical pixels
//                    (exact RGBA comparison, equal dimensions; pixelmatch's
//                    threshold and anti-alias filtering do not apply)
//   unchanged        no visual change intended: every scenario <= 0.1%
//                    pixelmatch-changed pixels
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
  unchanged(result) {
    if (withinTolerance(result)) return { row: {} };
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

export function runGate({ gate, expected, declared = expected, headDir, baseDir, approvedDir, diffDir }) {
  if (!GATES.includes(gate)) throw new Error(`unknown gate "${gate}" (expected ${GATES.join(", ")})`);
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

    const verdict = GATE_CHECKS[gate](result, { headFile: path.join(headDir, `${id}.png`), approvedDir, diffDir, id });
    Object.assign(row, verdict.row);
    if (verdict.failure) failures.push(`${id}: ${verdict.failure}`);
  }
  return { gate, rows, failures, ok: failures.length === 0 };
}

export function formatReport({ gate, rows, failures, ok, baseLabel, headLabel }) {
  const lines = [
    `# UI capture comparison - gate: ${gate}`,
    "",
    `base: ${baseLabel}`,
    `head: ${headLabel}`,
    `pixelmatch threshold ${PIXELMATCH_THRESHOLD}; unchanged/approved tolerance ${UNCHANGED_MAX_RATIO * 100}%`,
    "",
    "| scenario | status | changed px | changed % | exact-diff px |",
    "|---|---|---:|---:|---:|",
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.status} | ${row.changedPixels ?? "-"} | ${row.changedRatio === undefined ? "-" : (row.changedRatio * 100).toFixed(4)} | ${row.exactDifferentPixels ?? "-"} |`,
    ),
    "",
    ok ? `PASS (${rows.length} scenarios)` : `FAIL (${failures.length} problem(s))`,
    ...failures.map((failure) => `- ${failure}`),
    "",
  ];
  return lines.join("\n");
}
