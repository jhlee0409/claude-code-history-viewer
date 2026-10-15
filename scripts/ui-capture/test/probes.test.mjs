// minFontSize must include collapsed content: a smaller font hidden behind a
// disclosure control or a <details> is opened and sampled (real WebKit).

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";

// Needs the pinned WebKit build (`pnpm exec playwright install webkit`). CI
// does not install browsers, so the suite is skipped there and reports why.
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
if (!HAS_WEBKIT) console.warn(`[ui-capture] skipping probes.test: no WebKit at ${webkit.executablePath()}`);
import { runProbes } from "../lib/probes.mjs";

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
