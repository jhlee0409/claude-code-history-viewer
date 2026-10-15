// Gate semantics of lib/compare.mjs on generated PNGs (no browser).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comparePng, runGate } from "../lib/compare.mjs";

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
