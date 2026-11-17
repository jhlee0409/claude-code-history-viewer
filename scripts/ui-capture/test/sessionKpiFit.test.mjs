// Session Details KPI captions and values stay inside their tiles (#719).
//
// Analytics › Overview › Session Details in the real app, fixture HOME and
// WebKit. At 390px and 125% the English "TOKENS/MESSAGE" caption (one word:
// the browser does not break after its "/") ran past its grid cell, and the
// card clipped its last letters. Measured as text ranges, not page overflow:
// every caption, value and sub-caption lies within its tile's content box,
// and every tile within the card that clips, up to 360px at 200%. Root text
// enlargement and the app's font preference are independent. Before the fix
// (UI_TEST_DIST=<base dist>) the English 390px/125% case fails. Skipped
// without WebKit or a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator } from "../lib/i18n.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";
import { REPO, startApp } from "./appSession.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global document, getComputedStyle, NodeFilter */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "sessionKpiFit.test" }).enabled;
const LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"];
const CASES = [
  { width: 390, rootScale: 1, appScale: 100 },
  { width: 390, rootScale: 1.25, appScale: 100 },
  { width: 390, rootScale: 1.5, appScale: 100 },
  { width: 390, rootScale: 2, appScale: 100 },
  { width: 360, rootScale: 2, appScale: 100 },
  { width: 390, rootScale: 1, appScale: 120 },
  { width: 390, rootScale: 1, appScale: 130 },
  { width: 1440, rootScale: 1, appScale: 100 },
];
const LABELS = ["analytics.projectShare", "analytics.tokensPerMessage", "analytics.sessionTime", "analytics.percentile"];

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("session-kpi-fit");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

async function openSessionDetails(locale, { width, rootScale, appScale }) {
  const id = `analytics--${width >= 768 ? "1440x900" : "390x844"}--dark`;
  const original = expandScenarios().find((scenario) => scenario.id === id);
  const scenario = { ...original, viewport: { ...original.viewport, width } };
  const session = await newScenarioPage(browser, {
    scenario,
    origin: app.server.origin,
    locale,
    fixedNow: app.fixture.fixedNow,
    storageSeed: STORAGE_SEED,
  });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: app.fixture, t });
  await session.page.goto(`${app.server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: "session KPI initial" });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await session.page.getByRole("tab", { name: t("analytics.sessionDetails"), exact: true }).click();
  await settle(session, { label: "session details" });
  // Enlarge after navigating, so unrelated mobile navigation at 200% root
  // size cannot gate the containment check.
  if (appScale !== 100) await run({ do: "fontScale", percent: appScale });
  await session.page.evaluate((scale) => {
    document.documentElement.style.fontSize = `${16 * scale}px`;
  }, rootScale);
  await settle(session, { label: "session KPI ready" });
  return Object.assign(session, { t });
}

/** Each tile (found by its caption), the ink of its text and its overflow past the tile's content box and the clipping card. */
const measure = (page, labels) =>
  page.evaluate((labels) => {
    const spans = [...document.querySelectorAll("span")];
    return labels.map((label) => {
      const caption = spans.find((s) => s.textContent === label);
      if (!caption) return { label, missing: true };
      const tile = caption.parentElement.parentElement;
      let card = tile.parentElement;
      while (card && getComputedStyle(card).overflowX === "visible") card = card.parentElement;
      const style = getComputedStyle(tile);
      const bounds = tile.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const innerLeft = bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const innerRight = bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      let textOverflow = 0;
      const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width <= 0.3) continue;
          textOverflow = Math.max(textOverflow, innerLeft - r.left, r.right - innerRight);
        }
      }
      const captionRange = document.createRange();
      captionRange.selectNodeContents(caption);
      const captionBox = captionRange.getBoundingClientRect();
      return {
        label,
        textOverflow: Math.max(textOverflow, 0),
        captionOverflow: Math.max(innerLeft - captionBox.left, captionBox.right - innerRight, 0),
        cardOverflow: Math.max(cardBounds.left - bounds.left, bounds.right - cardBounds.right, 0),
        top: bounds.top,
        width: bounds.width,
      };
    });
  }, labels);

describe.skipIf(!ENABLED)("session KPI containment in real WebKit (#719)", () => {
  it.each(LOCALES)("%s: captions and values stay inside their tiles", async (locale) => {
    for (const size of CASES) {
      const session = await openSessionDetails(locale, size);
      try {
        const labels = LABELS.map((key) => session.t(key));
        await session.page.getByText(labels[1], { exact: true }).scrollIntoViewIfNeeded();
        const tiles = await measure(session.page, labels);
        const where = `${locale} ${JSON.stringify(size)}: ${JSON.stringify(tiles)}`;
        for (const tile of tiles) {
          expect(tile.missing, where).toBeUndefined();
          expect(tile.captionOverflow, where).toBeLessThanOrEqual(1);
          expect(tile.textOverflow, where).toBeLessThanOrEqual(1);
          expect(tile.cardOverflow, where).toBeLessThanOrEqual(1);
        }
        // Normal density is kept where it fits: four tiles in a desktop row,
        // all the same width.
        if (size.width === 1440) {
          expect(tiles.filter((tile) => Math.abs(tile.top - tiles[0].top) < 1).length, where).toBe(4);
          for (const tile of tiles) expect(Math.abs(tile.width - tiles[0].width), where).toBeLessThanOrEqual(1);
        }
        expect(session.log.pageErrors, where).toEqual([]);
      } finally {
        await session.close();
      }
    }
  }, 300_000);
});
