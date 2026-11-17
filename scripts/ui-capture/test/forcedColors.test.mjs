// Forced colours in the running app (inner-UI plan F1b, D10, G-FC1).
//
// Real Chromium with forcedColors: "active" (WebKit cannot emulate it), the
// real app and fixture. A selected item - the analytics sub-tab, the open
// project in the sidebar, the checked Edits scope radio and a still-pressed
// Edits diff button - must stay told
// apart: its computed border colour is the system Highlight colour and it
// carries a 2px Highlight underline. A keyboard-focused control gets a
// different mark: a 2px solid CanvasText outline (box-shadow rings vanish in
// this mode). Computed styles, not pixel ratios. Before F1b
// (UI_TEST_DIST=<base dist>) the selection checks fail. Set
// UI_FORCED_SHOTS_DIR to save a screenshot of each case. Skipped without
// Chromium or without a built server.

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { keyboardFocus, openScenario, startApp } from "./appSession.mjs";
import { editsScope, focusScopeRadio, uncheckedScopeRadio } from "./segmentedKeyboard.mjs";

/* global document, getComputedStyle */

const ENABLED = browserRequirement({ chromium: true, server: true }, { label: "forcedColors.test" }).enabled;
const SHOTS_DIR = process.env.UI_FORCED_SHOTS_DIR ? path.resolve(process.env.UI_FORCED_SHOTS_DIR) : null;

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("forced-colors");
  browser = await chromium.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** The computed rgb() of a system colour keyword in this page. */
const systemColor = (page, keyword) =>
  page.evaluate((kw) => {
    const probe = document.createElement("div");
    probe.style.color = kw;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, keyword);

const markStyle = (target) =>
  target.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      borderColors: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
      decorationLine: cs.textDecorationLine,
      decorationColor: cs.textDecorationColor,
      decorationThickness: cs.textDecorationThickness,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      focusVisible: el.matches(":focus-visible"),
    };
  });

async function shot(page, target, name) {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const box = await target.boundingBox();
  if (!box) return;
  const pad = 24;
  await page.screenshot({
    path: path.join(SHOTS_DIR, `${name}.png`),
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 },
  });
}

const SELECTED = [
  { name: "analytics-subtab", scenario: "analytics--1440x900--dark", target: (page) => page.locator('[data-analytics-tab][aria-selected="true"]').first() },
  { name: "sidebar-project", scenario: "transcript--1440x900--light", target: (page) => page.locator('[data-tree-node="project"][aria-selected="true"]').first() },
  { name: "edits-scope-checked", scenario: "recent-edits--1440x900--light", target: (page) => editsScope(page).getByRole("radio", { checked: true }) },
  { name: "edits-diff-pressed", scenario: "recent-edits--1440x900--light", target: (page) => page.locator("#main-content").getByRole("button", { name: "Show full diff", exact: true }).first(), prepare: async (session) => {
    const diff = session.page.getByRole("button", { name: session.t("recentEdits.showDiff"), exact: true }).first();
    await diff.click();
    expect(await diff.getAttribute("aria-pressed"), "ordinary diff toggle stays pressed").toBe("true");
  } },
];

describe.skipIf(!ENABLED)("forced colours (real Chromium)", () => {
  it.each(SELECTED)("$name: the selected item has a Highlight border and a 2px Highlight underline", async ({ name, scenario, target, prepare }) => {
    const session = await openScenario(browser, app, scenario, { variant: { forcedColors: "active" } });
    try {
      await prepare?.(session);
      const highlight = await systemColor(session.page, "Highlight");
      const el = target(session.page);
      await el.waitFor();
      expect(await el.count(), "selected control").toBe(1);
      const box = await el.boundingBox();
      expect(box.width, "selected width").toBeGreaterThan(0);
      expect(box.height, "selected height").toBeGreaterThan(0);
      const style = await markStyle(el);
      await shot(session.page, el, `${name}--selected`);
      expect(style.borderColors, JSON.stringify(style)).toEqual([highlight, highlight, highlight, highlight]);
      expect(style.decorationLine).toContain("underline");
      expect(style.decorationColor).toBe(highlight);
      expect(style.decorationThickness).toBe("2px");
    } finally {
      await session.close();
    }
  }, 120_000);

  it("keyboard focus is a 2px CanvasText outline, a different mark from selection", async () => {
    const session = await openScenario(browser, app, "recent-edits--1440x900--light", { variant: { forcedColors: "active" } });
    try {
      const canvasText = await systemColor(session.page, "CanvasText");
      const highlight = await systemColor(session.page, "Highlight");
      // Tab enters the checked scope; an arrow focuses/selects the previously
      // unchecked radio. A plain toolbar button still uses ordinary Tab.
      for (const [label, el, focus] of [
        ["edits-scope-arrow", await uncheckedScopeRadio(session.page), (target) => focusScopeRadio(session.page, target, keyboardFocus)],
        ["settings-button", session.page.locator("#app-settings-button"), (target) => keyboardFocus(session.page, target)],
      ]) {
        expect(await focus(el), label).toBe(true);
        const style = await markStyle(el);
        await shot(session.page, el, `${label}--focus`);
        expect(style.focusVisible, label).toBe(true);
        expect(style, label).toMatchObject({ outlineStyle: "solid", outlineWidth: "2px", outlineColor: canvasText });
        expect(canvasText).not.toBe(highlight);
      }
    } finally {
      await session.close();
    }
  }, 120_000);

  it("an inset-ring control keeps its focus outline inside its box, where its container cannot clip it", async () => {
    const session = await openScenario(browser, app, "recent-edits--1440x900--light", { variant: { forcedColors: "active" } });
    try {
      const canvasText = await systemColor(session.page, "CanvasText");
      // The app's inset-ring control (a phone-only palette button) is hidden
      // at this width, so the test adds a button with the same class.
      await session.page.evaluate(() => {
        const probe = document.createElement("button");
        probe.type = "button";
        probe.id = "inset-ring-probe";
        probe.className = "focus-ring-inset";
        probe.textContent = "inset";
        document.querySelector("#main-content").prepend(probe);
      });
      const el = session.page.locator("#inset-ring-probe");
      expect(await keyboardFocus(session.page, el)).toBe(true);
      const style = await el.evaluate((node) => {
        const cs = getComputedStyle(node);
        return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, outlineOffset: cs.outlineOffset };
      });
      await shot(session.page, el, "inset-ring--focus");
      expect(style).toEqual({ outlineStyle: "solid", outlineWidth: "2px", outlineColor: canvasText, outlineOffset: "-2px" });
    } finally {
      await session.close();
    }
  }, 120_000);
});
