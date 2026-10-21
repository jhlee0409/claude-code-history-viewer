// The one keyboard focus ring (inner-UI plan F1b, D7 base-layer share,
// G-ST1).
//
// Real WebKit, the real app. Walk the first Tab stops (Alt+Tab: WebKit's
// plain Tab skips buttons) on the conversation and settings screens. Every
// stop that does not opt out of the base ring itself (an `outline-none` /
// `outline-hidden` class - primitives that F2a moves onto the token) shows
// the base ring: a 2px solid outline in the --focus-ring colour, 2px
// outside. A mouse click on a button does not show it (:focus-visible stays
// false). Before F1b (UI_TEST_DIST=<base dist>) the base layer removed the
// outline, so the ring check fails. Set UI_FOCUS_SHOTS_DIR to save a crop of
// each ringed stop. Skipped without WebKit or without a built server.

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "focusRing.test" }).enabled;
const SHOTS_DIR = process.env.UI_FOCUS_SHOTS_DIR ? path.resolve(process.env.UI_FOCUS_SHOTS_DIR) : null;
const MAX_STOPS = 30;

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("focus-ring");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const FOCUS_INFO = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const probe = document.createElement("div");
  probe.style.color = "var(--focus-ring)";
  document.body.appendChild(probe);
  const ring = getComputedStyle(probe).color;
  probe.remove();
  const r = el.getBoundingClientRect();
  return {
    key: `${el.tagName}|${el.id}|${el.getAttribute("aria-label") ?? ""}|${(el.textContent ?? "").trim().slice(0, 30)}|${Math.round(r.x)},${Math.round(r.y)}`,
    label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40),
    optsOut: /(^|\s)([\w-]+:)*outline-(none|hidden)(\s|$)/.test(el.getAttribute("class") ?? ""),
    focusVisible: el.matches(":focus-visible"),
    outline: { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, color: cs.outlineColor },
    ring,
    box: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
};

async function walkStops(page, shotPrefix) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(1, 1);
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < MAX_STOPS; i += 1) {
    await page.keyboard.press("Alt+Tab");
    const info = await page.evaluate(FOCUS_INFO);
    if (!info) continue;
    if (seen.has(info.key)) break;
    seen.add(info.key);
    stops.push(info);
    if (SHOTS_DIR && !info.optsOut && info.box.width > 0) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      const pad = 8;
      await page.screenshot({
        path: path.join(SHOTS_DIR, `${shotPrefix}--stop-${String(stops.length).padStart(2, "0")}.png`),
        clip: { x: Math.max(0, info.box.x - pad), y: Math.max(0, info.box.y - pad), width: info.box.width + pad * 2, height: info.box.height + pad * 2 },
      });
    }
  }
  return stops;
}

describe.skipIf(!ENABLED)("the base focus ring (real WebKit)", () => {
  it.each(["transcript--1440x900--light", "transcript--1440x900--dark", "settings--1440x900--dark"])(
    "%s: every keyboard stop without its own opt-out shows the 2px --focus-ring outline",
    async (id) => {
      const session = await openScenario(browser, app, id);
      try {
        const stops = await walkStops(session.page, id);
        const covered = stops.filter((s) => !s.optsOut);
        expect(covered.length, JSON.stringify(stops.map((s) => s.label))).toBeGreaterThan(0);
        // The base ring: 2px solid, --focus-ring colour (a component's own 2px ring, e.g. the segmented item's, also passes).
        const notRinged = covered.filter((s) => !(s.focusVisible && s.outline.style === "solid" && s.outline.width === "2px"));
        expect(notRinged.map((s) => `${s.label}: ${JSON.stringify(s.outline)}`)).toEqual([]);
        const base = covered.filter((s) => s.outline.offset === "2px");
        expect(base.length).toBeGreaterThan(0);
        for (const s of base) expect(s.outline.color, s.label).toBe(s.ring);
      } finally {
        await session.close();
      }
    },
    120_000,
  );

  it("a mouse click on a button does not show the ring", async () => {
    const session = await openScenario(browser, app, "transcript--1440x900--light");
    try {
      const button = session.page.locator('[data-tree-node="project"]').first();
      await button.click();
      const state = await session.page.evaluate(() => {
        const el = document.activeElement;
        return { focusVisible: !!el && el !== document.body && el.matches(":focus-visible"), outline: el ? getComputedStyle(el).outlineStyle : null };
      });
      expect(state.focusVisible, JSON.stringify(state)).toBe(false);
    } finally {
      await session.close();
    }
  }, 120_000);
});
