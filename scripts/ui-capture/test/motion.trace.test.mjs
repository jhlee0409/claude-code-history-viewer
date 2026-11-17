import { describe, expect, it } from "vitest";
import { hasScrollGlide } from "../lib/motion.mjs";

const trace = (tops, frames = tops.map((_, i) => i), target = 1) => tops.map((top, i) => ({ target, frame: frames[i], top }));

describe("scroll-position glide detection", () => {
  it("allows the CI three-frame shape, including monotone instant corrections", () => {
    // CI only retained frame counts [3, 3], NOT positions. These positions
    // are synthetic witnesses for that shape, not reconstructed CI data.
    expect(hasScrollGlide(trace([0, 1200, 1212, 1218]))).toBe(false);
    expect(hasScrollGlide(trace([0, 1200, 1192, 1198]))).toBe(false);
  });

  it.each([1, -1])("detects CI smooth motion despite a dominant middle step (direction %s)", (direction) => {
    // Actual positions from CI run 44063641192; only the reverse is synthetic.
    expect(hasScrollGlide(trace([0, 162, 1318, 1476, 1500].map((n) => n * direction)))).toBe(true);
  });

  it.each([1, -1])("rejects distributed smooth movement in direction %s", (direction) => {
    expect(hasScrollGlide(trace([0, 3, 15, 40, 75, 110, 135, 147, 150].map((n) => n * direction)))).toBe(true);
  });

  it("rejects a glide after an instant landing, not just from the initial position", () => {
    expect(hasScrollGlide(trace([0, 1200, 1204, 1214, 1230, 1244, 1250]))).toBe(true);
  });

  it.each([1, -1])("keeps the observed WebKit onset through merged/missed paints (direction %s)", (direction) => {
    // Real local WebKit 2359 / Playwright 1.63.0 capture. Keep the onset and
    // endpoint, omit arbitrary interior paints, then renumber rAF samples:
    // a busy browser may paint fewer positions, NOT emit across a trace gap.
    const tops = [0, 62, 248, 523, 777, 1002, 1162, 1280, 1366, 1426, 1466, 1490, 1499, 1500];
    const interior = tops.slice(2, -1);
    for (let mask = 0; mask < 2 ** interior.length; mask += 1) {
      const kept = interior.filter((_, i) => mask & (1 << i));
      if (kept.length < 2) continue; // at least four moving observations
      const sampled = [0, tops[1], ...kept, tops.at(-1)];
      expect(hasScrollGlide(trace(sampled.map((n) => n * direction))), JSON.stringify(sampled)).toBe(true);
      // Matched synthetic instant landing with the same observation count.
      const corrections = sampled.map((_, i) => i === 0 ? 0 : 1200 + (i - 1) * 4);
      expect(hasScrollGlide(trace(corrections.map((n) => n * direction))), JSON.stringify(corrections)).toBe(false);
    }
  });

  it("documents the insufficient-evidence limit when paints lose the onset or leave fewer than four steps", () => {
    expect(hasScrollGlide(trace([0, 1318, 1476, 1500]))).toBe(false);
    expect(hasScrollGlide(trace([0, 162, 1476, 1500]))).toBe(false);
  });

  it("allows long equal or decaying instant-correction runs, including their suffixes", () => {
    expect(hasScrollGlide(trace([0, 1200, 1204, 1208, 1212, 1216, 1220]))).toBe(false);
    expect(hasScrollGlide(trace([0, 1200, 1232, 1248, 1256, 1260, 1262]))).toBe(false);
  });

  it("allows a landing followed by only three small measurement corrections", () => {
    expect(hasScrollGlide(trace([0, 1200, 1204, 1208, 1212]))).toBe(false);
  });

  it("does not join separated frames, direction changes or different scrollers", () => {
    expect(hasScrollGlide(trace([0, 10, 20, 30, 40], [0, 1, 2, 4, 5]))).toBe(false);
    expect(hasScrollGlide(trace([0, 10, 20, 10, 0, 10, 20]))).toBe(false);
    expect(hasScrollGlide([...trace([0, 10, 20]), ...trace([0, 10, 20], [0, 1, 2], 2)])).toBe(false);
  });

  it("coalesces same-frame events without inventing moving frames", () => {
    expect(hasScrollGlide(trace([0, 10, 20, 30, 40], [0, 1, 1, 2, 3]))).toBe(false);
    expect(hasScrollGlide([])).toBe(false);
  });
});
