// Gate semantics of lib/compare.mjs on generated PNGs (no browser).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comparePng, formatReport, runGate } from "../lib/compare.mjs";
import { ExpectedChangesError, expectedChangesFromBody } from "../lib/expectedChanges.mjs";

const SIZE = 100;
let root;

/** Write a SIZE×SIZE PNG filled with `rgb`, then apply `edits` [{x, y, rgb}]. */
function writePng(file, rgb, edits = []) {
  const png = new PNG({ width: SIZE, height: SIZE });
  const put = (x, y, [r, g, b]) => {
    const i = (y * SIZE + x) * 4;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  };
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) put(x, y, rgb);
  for (const edit of edits) put(edit.x, edit.y, edit.rgb);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

const WHITE = [255, 255, 255];
const dirs = () => ({
  baseDir: path.join(root, "base"),
  headDir: path.join(root, "head"),
  approvedDir: path.join(root, "approved"),
  diffDir: path.join(root, "diff"),
});
const gate = (name, id = "s") => runGate({ gate: name, expected: [id], ...dirs() });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-compare-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("reproducibility gate", () => {
  it("passes identical captures", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), WHITE);
    const outcome = gate("reproducibility");
    expect(outcome.ok).toBe(true);
    expect(outcome.rows[0].exactDifferentPixels).toBe(0);
  });

  it("fails on a single exactly-differing pixel that pixelmatch ignores", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), WHITE, [{ x: 50, y: 50, rgb: [254, 254, 254] }]);
    const outcome = gate("reproducibility");
    expect(outcome.rows[0].changedPixels).toBe(0); // below the pixelmatch threshold
    expect(outcome.rows[0].exactDifferentPixels).toBe(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.rows[0].status).toBe("changed");
  });

  it("fails a low-contrast change of every pixel", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), [254, 254, 254]);
    const outcome = gate("reproducibility");
    expect(outcome.rows[0].changedPixels).toBe(0);
    expect(outcome.rows[0].exactDifferentPixels).toBe(SIZE * SIZE);
    expect(outcome.ok).toBe(false);
  });

  it("fails on a size mismatch", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    const small = new PNG({ width: 10, height: 10 });
    fs.mkdirSync(dirs().headDir, { recursive: true });
    fs.writeFileSync(path.join(dirs().headDir, "s.png"), PNG.sync.write(small));
    expect(gate("reproducibility").ok).toBe(false);
  });
});

describe("unchanged gate", () => {
  it("tolerates a change within 0.1% and rejects one beyond it", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), WHITE, [{ x: 1, y: 1, rgb: [0, 0, 0] }]);
    expect(gate("unchanged").ok).toBe(true);

    const many = Array.from({ length: 20 }, (_, i) => ({ x: i * 4, y: 10, rgb: [0, 0, 0] }));
    writePng(path.join(dirs().headDir, "s.png"), WHITE, many);
    expect(gate("unchanged").ok).toBe(false);
  });
});

describe("unchanged gate with expected changes (--expect-changed)", () => {
  // 20 of 10,000 pixels = 0.2% (over the 0.1% tolerance); one pixel = 0.01%.
  const twentyDots = Array.from({ length: 20 }, (_, i) => ({ x: i * 4, y: 10, rgb: [0, 0, 0] }));
  const oneDot = [{ x: 1, y: 1, rgb: [0, 0, 0] }];
  const shoot = (id, headEdits) => {
    writePng(path.join(dirs().baseDir, `${id}.png`), WHITE);
    writePng(path.join(dirs().headDir, `${id}.png`), WHITE, headEdits);
  };
  const unchanged = (expected, expectChanged) => runGate({ gate: "unchanged", expected, expectChanged, ...dirs() });

  it("lets a declared scenario exceed 0.1% as expected-change and still fails an undeclared one", () => {
    shoot("a", twentyDots);
    shoot("b", twentyDots);
    const outcome = unchanged(["a", "b"], ["a"]);
    expect(outcome.ok).toBe(false);
    expect(outcome.rows[0]).toMatchObject({ id: "a", status: "expected-change", expectedBy: "a", changedRatio: 0.002 });
    expect(outcome.rows[1]).toMatchObject({ id: "b", status: "changed" });
    expect(outcome.failures).toEqual(["b: 0.2000% changed (> 0.1%)"]);
    expect(outcome.expectedChanges).toEqual([{ id: "a", changedRatio: 0.002, expectedBy: "a" }]);
    expect(fs.existsSync(path.join(dirs().diffDir, "a.png"))).toBe(true); // evidence stays
  });

  it("passes when every change is declared; a prefix glob covers its scenarios", () => {
    shoot("home--wide--dark", twentyDots);
    shoot("home--phone--dark", twentyDots);
    shoot("settings--phone--dark", []);
    const outcome = unchanged(["home--wide--dark", "home--phone--dark", "settings--phone--dark"], ["home--*"]);
    expect(outcome.ok).toBe(true);
    expect(outcome.rows.map((row) => row.status)).toEqual(["expected-change", "expected-change", "ok"]);
    expect(outcome.rows[0].expectedBy).toBe("home--*");
    expect(outcome.warnings).toEqual([]);
  });

  it("warns, without failing, when a declared entry changed nothing beyond 0.1%", () => {
    shoot("a", []);
    shoot("b", oneDot);
    shoot("glob--1", twentyDots);
    shoot("glob--2", []);
    shoot("quiet--1", oneDot);
    const outcome = unchanged(["a", "b", "glob--1", "glob--2", "quiet--1"], ["a", "b", "glob--*", "quiet--*"]);
    expect(outcome.ok).toBe(true);
    expect(outcome.rows.map((row) => row.status)).toEqual(["ok", "ok", "expected-change", "ok", "ok"]);
    expect(outcome.warnings).toEqual([
      "a: declared as an expected change, but changed 0.0000% (<= 0.1%)",
      "b: declared as an expected change, but changed 0.0100% (<= 0.1%)",
      "quiet--*: declared as an expected change, but none of its 1 scenario(s) changed more than 0.1% (max 0.0100%)",
    ]);
  });

  it("still fails a declared scenario without a capture", () => {
    writePng(path.join(dirs().baseDir, "a.png"), WHITE);
    const outcome = unchanged(["a"], ["a"]);
    expect(outcome.ok).toBe(false);
    expect(outcome.rows[0].status).toBe("missing-head");
    expect(outcome.warnings).toEqual([]);
  });

  it("refuses an entry that matches no compared scenario (a typo)", () => {
    shoot("a", twentyDots);
    expect(() => unchanged(["a"], ["a", "nope--*"])).toThrow(ExpectedChangesError);
    expect(() => unchanged(["a"], ["a", "nope--*"])).toThrow(/nope--\*/);
  });

  it("refuses expected changes under the other gates", () => {
    shoot("a", twentyDots);
    for (const name of ["reproducibility", "changed"]) {
      expect(() => runGate({ gate: name, expected: ["a"], expectChanged: ["a"], ...dirs() })).toThrow(/unchanged/);
    }
  });
});

describe("formatReport", () => {
  const twentyDots = Array.from({ length: 20 }, (_, i) => ({ x: i * 4, y: 10, rgb: [0, 0, 0] }));
  const labels = { baseLabel: "base", headLabel: "head" };

  it("lists the declared entries, each expected change with its % and the warnings", () => {
    for (const [id, edits] of [["a", twentyDots], ["b", []]]) {
      writePng(path.join(dirs().baseDir, `${id}.png`), WHITE);
      writePng(path.join(dirs().headDir, `${id}.png`), WHITE, edits);
    }
    const report = formatReport({ ...runGate({ gate: "unchanged", expected: ["a", "b"], expectChanged: ["a", "b"], ...dirs() }), ...labels });
    expect(report).toContain("expected changes (--expect-changed): a, b");
    expect(report).toContain("| a | expected-change | 20 | 0.2000 | 20 |");
    expect(report).toContain("PASS (2 scenarios, 1 expected change)");
    expect(report).toContain("Expected changes (1):\n- a: 0.2000% changed");
    expect(report).toContain("Warnings (1):\n- b: declared as an expected change, but changed 0.0000% (<= 0.1%)");
  });

  it("ends a failed unchanged gate with the declaration for the changed scenarios, which a pasted report does not make", () => {
    for (const id of ["a", "b"]) {
      writePng(path.join(dirs().baseDir, `${id}.png`), WHITE);
      writePng(path.join(dirs().headDir, `${id}.png`), WHITE, twentyDots);
    }
    const report = formatReport({ ...runGate({ gate: "unchanged", expected: ["a", "b"], ...dirs() }), ...labels });
    expect(report).toContain("FAIL (2 problem(s))");
    expect(report).toContain("If these changes are intended");
    expect(report).toMatch(/PR body \(CI\): +ui-expected-changes: a, b\n/);
    expect(report).toMatch(/locally: +--expect-changed a,b\n/);
    // Never at the start of a line: a report pasted into the PR body as
    // evidence must not declare anything by itself.
    expect(expectedChangesFromBody(report)).toEqual([]);
  });

  it("adds nothing about expected changes when none were declared", () => {
    writePng(path.join(dirs().baseDir, "a.png"), WHITE);
    writePng(path.join(dirs().headDir, "a.png"), WHITE);
    const report = formatReport({ ...runGate({ gate: "unchanged", expected: ["a"], ...dirs() }), ...labels });
    expect(report).not.toMatch(/expected change|Warnings|ui-expected-changes/i);
    expect(report).toContain("PASS (1 scenarios)");
  });
});

describe("changed gate", () => {
  const twentyDots = Array.from({ length: 20 }, (_, i) => ({ x: i * 4, y: 10, rgb: [0, 0, 0] }));

  it("does not demand approval for a difference within the unchanged tolerance", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), WHITE, [{ x: 1, y: 1, rgb: [0, 0, 0] }]);
    const outcome = gate("changed");
    expect(outcome.ok).toBe(true);
    expect(outcome.rows[0].status).toBe("within-tolerance");
  });

  it("demands approval beyond the tolerance and accepts a matching approved baseline", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), WHITE, twentyDots);
    const unapproved = gate("changed");
    expect(unapproved.ok).toBe(false);
    expect(unapproved.rows[0].status).toBe("unapproved-change");

    writePng(path.join(dirs().approvedDir, "s.png"), WHITE, twentyDots);
    const approved = gate("changed");
    expect(approved.ok).toBe(true);
    expect(approved.rows[0].status).toBe("approved-change");
  });

  it("fails when the head drifts from its approved baseline", () => {
    writePng(path.join(dirs().baseDir, "s.png"), WHITE);
    writePng(path.join(dirs().headDir, "s.png"), WHITE);
    writePng(path.join(dirs().approvedDir, "s.png"), WHITE, twentyDots);
    const outcome = gate("changed");
    expect(outcome.ok).toBe(false);
    expect(outcome.rows[0].status).toBe("differs-from-approved");
  });
});

describe("comparePng", () => {
  it("reports exact and thresholded counts separately", () => {
    const a = path.join(root, "a.png");
    const b = path.join(root, "b.png");
    writePng(a, WHITE);
    writePng(b, WHITE, [{ x: 0, y: 0, rgb: [0, 0, 0] }, { x: 9, y: 9, rgb: [254, 254, 254] }]);
    const result = comparePng(a, b);
    expect(result.exactDifferentPixels).toBe(2);
    expect(result.changedPixels).toBe(1);
  });
});
