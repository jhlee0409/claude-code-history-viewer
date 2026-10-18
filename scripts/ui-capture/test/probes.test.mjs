// minFontSize must include collapsed content: a smaller font hidden behind a
// disclosure control or a <details> is opened and sampled (real WebKit).

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";

// Needs the pinned WebKit build (`pnpm exec playwright install webkit`). CI
// does not install browsers, so the suite is skipped there and reports why.
// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit into an error.
const HAS_WEBKIT = browserRequirement({ webkit: true }, { label: "probes.test" }).enabled;
import { runProbes } from "../lib/probes.mjs";
import { TYPOGRAPHY_PROBE, parseFontFamily } from "../lib/typography.mjs";
import { browserRequirement } from "./requirements.mjs";

const PAGE = `<!doctype html><html><body style="margin:0;font-size:16px">
<main data-slot="main" style="height:600px;overflow:auto">
  <p style="font-size:12px">Visible summary</p>
  <button aria-expanded="false" style="font-size:12px"
    onclick="this.setAttribute('aria-expanded','true');document.getElementById('body').hidden=false">Tool result</button>
  <div id="body" hidden style="font-size:6px">tiny tool output</div>
  <details><summary style="font-size:12px">Thinking</summary><span style="font-size:7px">tiny thought</span></details>
  <button aria-expanded="false" aria-haspopup="menu" style="font-size:12px"
    onclick="document.getElementById('menu').hidden=false">Menu</button>
  <div id="menu" hidden style="font-size:3px">menu item</div>
</main></body></html>`;

let browser;
beforeAll(async () => {
  if (HAS_WEBKIT) browser = await webkit.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function probe(options) {
  const page = await browser.newPage();
  try {
    await page.clock.install();
    await page.setContent(PAGE);
    return await runProbes(page, options);
  } finally {
    await page.close();
  }
}

describe.skipIf(!HAS_WEBKIT)("runProbes minFontSize", () => {
  it("misses collapsed content when expansion is off (the regression)", async () => {
    const { minFontSize } = await probe({ expandCollapsed: false });
    expect(minFontSize.px).toBe(12);
    expect(minFontSize.expandedControls).toBe(0);
  }, 30_000);

  it("samples content opened from disclosure controls and <details>", async () => {
    const { minFontSize } = await probe();
    expect(minFontSize.px).toBe(6);
    expect(minFontSize.at.text).toBe("tiny tool output");
    // the button and the <details>; the menu button (aria-haspopup) is left alone
    expect(minFontSize.expandedControls).toBe(2);
  }, 30_000);
});

const TYPE_PAGE = `<!doctype html><html lang="ja" style="--app-font-scale: 1.1"><head><style>
  :root { --font-ui: "IBM Plex Sans", "Hiragino Sans", sans-serif; }
  body { margin: 0; font-family: var(--font-ui); }
  .text-caption { font-size: calc(12px * var(--app-font-scale)); line-height: 1.4; }
  .text-body { font-size: calc(15px * var(--app-font-scale)); line-height: 1.7; }
  .forced { font-size: 9px; }
</style></head><body>
  <p class="text-caption">caption</p>
  <p class="text-caption forced">forced small</p>
  <p class="text-body" hidden>hidden body</p>
  <p class="text-body md:text-caption" style="font-size: 9px">responsive: the active step is unknown</p>
</body></html>`;

describe.skipIf(!HAS_WEBKIT)("TYPOGRAPHY_PROBE", () => {
  it("reads lang, scale, font order, each step's computed size and the sizes rendered with a step class", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(TYPE_PAGE);
      const typography = await page.evaluate(TYPOGRAPHY_PROBE);
      expect(typography.lang).toBe("ja");
      expect(typography.appFontScale).toBe(1.1);
      expect(parseFontFamily(typography.bodyFontFamily)).toEqual(["IBM Plex Sans", "Hiragino Sans", "sans-serif"]);
      expect(typography.steps.caption.fontSize).toBeCloseTo(13.2, 2);
      expect(parseFloat(typography.steps.body.lineHeight) / typography.steps.body.fontSize).toBeCloseTo(1.7, 2);
      // the visible .text-caption elements: one at the step size, one overridden; hidden ones are ignored
      expect(typography.used.caption.map((n) => Math.round(n * 10) / 10)).toEqual([9, 13.2]);
      // hidden elements and elements with a responsive step variant are not judged
      expect(typography.used.body).toEqual([]);
      // the probe spans are removed again
      expect(await page.locator("[aria-hidden=true]").count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30_000);
});
