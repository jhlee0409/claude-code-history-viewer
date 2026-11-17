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

  it.each([1, -1])("rejects distributed smooth movement in direction %s", (direction) => {
    expect(hasScrollGlide(trace([0, 3, 15, 40, 75, 110, 135, 147, 150].map((n) => n * direction)))).toBe(true);
  });

  it("rejects a glide after an instant landing, not just from the initial position", () => {
    expect(hasScrollGlide(trace([0, 1200, 1204, 1214, 1230, 1244, 1250]))).toBe(true);
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
