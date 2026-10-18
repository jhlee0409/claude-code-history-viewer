// The visible-change judgement behind `ui:states` and focusVisible (plan I0):
// 0% change → not visible; a real change → visible; noise below the channel
// threshold → not visible.

import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { CHANNEL_DELTA, focusChange, pixelChange } from "../lib/statesJudge.mjs";
import { summarizeStates } from "../states/judge.mjs";

const solid = (w, h, rgb, paint) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (w * y + x) * 4;
      const [r, g, b] = paint?.(x, y) ?? rgb;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

describe("focusChange", () => {
  it("0% change → not visible", () => {
    const a = solid(40, 20, [200, 200, 200]);
    expect(focusChange(a, a)).toMatchObject({ changedPx: 0, fraction: 0, visible: false });
  });

  it("a 2px ring around the control → visible", () => {
    const rest = solid(40, 20, [200, 200, 200]);
    const ring = solid(40, 20, null, (x, y) => (x < 2 || y < 2 || x > 37 || y > 17 ? [20, 99, 255] : [200, 200, 200]));
    const change = focusChange(rest, ring);
    expect(change.visible).toBe(true);
    expect(change.fraction).toBeGreaterThan(0.2);
  });

  it("noise at or below the channel threshold → not visible", () => {
    const a = solid(40, 20, [200, 200, 200]);
    const b = solid(40, 20, [200 + CHANNEL_DELTA, 200, 200]);
    expect(pixelChange(a, b).changedPx).toBe(0);
    expect(focusChange(a, b).visible).toBe(false);
  });
});

describe("summarizeStates", () => {
  it("reports each state's visibility share per control and fails an empty gallery", () => {
    const summary = summarizeStates([
      { ctl: "button:default", src: "default", focusable: true, focus: { visible: false }, hover: { visible: true }, active: { visible: false } },
      { ctl: "button:outline", src: "default", focusable: true, focus: { visible: true }, hover: { visible: true }, active: { visible: true } },
      { ctl: "badge:default", src: "default", focusable: false, hover: { visible: false } },
    ]);
    expect(summary.focus).toEqual({ population: 2, visible: 1 });
    expect(summary.hover).toEqual({ population: 3, visible: 2 });
    expect(summary.active).toEqual({ population: 2, visible: 1 });
    expect(summarizeStates([]).failures).toEqual(["empty gallery: no controls measured"]);
  });
});
