import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// F1c's bounded declaration cleanup, audited against tracked app/scripts sources.
// Do not delete glass/noise/glow declarations: live CSS/TokenStatsViewer references exist.
describe("F1c dead legacy declarations", () => {
  it("does not retain the unused private spacing/z-index scales or two unused gradients", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).not.toMatch(/^\s*--(?:space-[\w.\\-]+|z-(?:base|dropdown|sticky|modal|popover|tooltip|toast)|gradient-(?:subtle|surface))\s*:/m);
  });
});
