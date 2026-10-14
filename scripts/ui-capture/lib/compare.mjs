// Pixel comparison and the three gates.
//
//   reproducibility  same commit twice: every scenario 0 changed pixels
//   unchanged        no visual change intended: every scenario <= 0.1%
//   changed          intended visual change: a scenario that differs from the
//                    base must match an approved baseline (<= 0.1%); diff
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

    if (gate === "reproducibility") {
      if (result.changedPixels !== 0) {
        row.status = "changed";
        failures.push(`${id}: ${result.changedPixels} changed pixels (reproducibility requires 0)`);
      }
    } else if (gate === "unchanged") {
      if (result.changedRatio > UNCHANGED_MAX_RATIO) {
        row.status = "changed";
        failures.push(`${id}: ${(result.changedRatio * 100).toFixed(4)}% changed (> 0.1%)`);
      }
    } else if (result.changedPixels > 0) {
      // gate === "changed": a differing scenario needs an approved baseline.
      const approved = path.join(approvedDir, `${id}.png`);
      if (!fs.existsSync(approved)) {
        row.status = "unapproved-change";
        failures.push(`${id}: differs from base (${result.changedPixels} px) and has no approved baseline in ${approvedDir}`);
      } else {
        const vsApproved = comparePng(approved, path.join(headDir, `${id}.png`), path.join(diffDir, "vs-approved", `${id}.png`));
        row.vsApproved = vsApproved;
        if (vsApproved.changedRatio > UNCHANGED_MAX_RATIO) {
          row.status = "differs-from-approved";
          failures.push(`${id}: ${(vsApproved.changedRatio * 100).toFixed(4)}% off the approved baseline (> 0.1%)`);
        } else {
          row.status = "approved-change";
        }
      }
    }
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
