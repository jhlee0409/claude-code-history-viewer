// prefers-contrast: more in the running app (inner-UI plan F1b, D11, G-FC4).
//
// Real WebKit with Playwright's `contrast` emulation, the real app. With the
// OS asking for more contrast and no choice made in the gear menu, the app
// turns its high-contrast theme on: secondary text (--fg-2, --fg-3) reaches
// 7:1 on the canvas and the input border (--line-input) 4.5:1, measured from
// the colours the browser computes (painted through a canvas, so whatever
// colour syntax the engine serialises). The user's own choice wins: a stored
// "off" keeps standard contrast. Without the OS setting nothing changes.
// Before F1b (UI_TEST_DIST=<base dist>) the OS setting changed nothing.
// Skipped without WebKit or without a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, localStorage, matchMedia */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "contrast.more.test" }).enabled;
const CHOICE_KEY = "webui:settings.json:highContrast";

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("contrast-more");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** WCAG ratios of token pairs as painted on `<body>`. */
const ratios = (page, pairs) =>
  page.evaluate((list) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgb = (token) => {
      const probe = document.createElement("div");
      probe.style.color = `var(--${token})`;
      document.body.appendChild(probe);
      const css = getComputedStyle(probe).color;
      probe.remove();
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a !== 255) throw new Error(`--${token} is not opaque: ${css}`);
      return [r, g, b];
    };
    const lum = ([r, g, b]) => {
      const lin = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    return Object.fromEntries(
      list.map(([fg, bg]) => {
        const [hi, lo] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x);
        return [`${fg} on ${bg}`, Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100];
      }),
    );
  }, pairs);

const isHighContrast = (page) => page.evaluate(() => document.documentElement.classList.contains("high-contrast"));

describe.skipIf(!ENABLED)("prefers-contrast: more (real WebKit)", () => {
  it.each(["light", "dark"])("%s: the OS setting turns high contrast on; secondary text ≥ 7:1, input border ≥ 4.5:1", async (theme) => {
    const session = await openScenario(browser, app, `transcript--1440x900--${theme}`, { variant: { contrast: "more" } });
    try {
      expect(await session.page.evaluate(() => matchMedia("(prefers-contrast: more)").matches)).toBe(true);
      expect(await isHighContrast(session.page)).toBe(true);
      const r = await ratios(session.page, [
        ["fg-2", "surface-canvas"],
        ["fg-3", "surface-canvas"],
        ["line-input", "surface-canvas"],
      ]);
      expect(r["fg-2 on surface-canvas"], JSON.stringify(r)).toBeGreaterThanOrEqual(7);
      expect(r["fg-3 on surface-canvas"], JSON.stringify(r)).toBeGreaterThanOrEqual(7);
      expect(r["line-input on surface-canvas"], JSON.stringify(r)).toBeGreaterThanOrEqual(4.5);
    } finally {
      await session.close();
    }
  }, 120_000);

  it("the user's own choice wins over the OS setting (gear menu: high contrast off)", async () => {
    const session = await openScenario(browser, app, "transcript--1440x900--light", { variant: { contrast: "more" } });
    try {
      expect(await isHighContrast(session.page)).toBe(true);
      await session.page.locator("#app-settings-button").click();
      const item = session.page.getByRole("menuitem", { name: session.t("common.settings.accessibility.highContrast") });
      await expect.poll(() => item.getByRole("switch", { includeHidden: true }).getAttribute("aria-checked")).toBe("true");
      await item.click();
      await expect.poll(() => isHighContrast(session.page)).toBe(false);
      // Stored as the user's choice (the desktop app reads it back on start).
      expect(await session.page.evaluate((key) => localStorage.getItem(key), CHOICE_KEY)).toBe("false");
      // ...and the OS setting no longer turns it back on.
      await session.page.emulateMedia({ contrast: "no-preference" });
      await session.page.emulateMedia({ contrast: "more" });
      expect(await isHighContrast(session.page)).toBe(false);
    } finally {
      await session.close();
    }
  }, 120_000);

  it("without the OS setting or a choice, contrast stays standard", async () => {
    const session = await openScenario(browser, app, "transcript--1440x900--light");
    try {
      expect(await isHighContrast(session.page)).toBe(false);
    } finally {
      await session.close();
    }
  }, 120_000);
});
