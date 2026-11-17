// KPI values must fit their own tiles, not merely remain on one line (#695).
// Use the real app, fixture HOME and WebKit. Root text enlargement and the
// app's font preference are independent: neither may shrink the numeric type.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator } from "../lib/i18n.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";
import { keyboardFocus, REPO, startApp } from "./appSession.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global document, getComputedStyle */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "tokenKpiFit.test" }).enabled;
const LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"];
const CASES = [
  { width: 390, rootScale: 1, appScale: 100 },
  { width: 390, rootScale: 1.3, appScale: 100 },
  { width: 390, rootScale: 1.5, appScale: 100 },
  { width: 390, rootScale: 2, appScale: 100 },
  { width: 360, rootScale: 2, appScale: 100 },
  { width: 390, rootScale: 1, appScale: 130 },
  { width: 1440, rootScale: 1, appScale: 100 },
];
// The compact formatter currently rounds 999,900 to 1M in English. Keep that
// boundary input, a wide 99.9M total and a noncompact grouped message count.
const SUMMARY = {
  total_messages: 999_999,
  total_tokens: 99_900_000,
  token_distribution: {
    input: 999_900,
    output: 526_500,
    cache_creation: 17_600,
    cache_read: 53_656_000,
    reasoning: 44_700_000,
  },
};

let app;
let browser;
const report = [];

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("token-kpi-fit");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  if (process.env.UI_KPI_FIT_REPORT && report.length) {
    fs.writeFileSync(process.env.UI_KPI_FIT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  }
  await browser?.close();
  await app?.stop();
});

async function openKpis(locale, { width, rootScale, appScale }) {
  const id = `analytics-tokens--${width >= 768 ? "1440x900" : "390x844"}--dark`;
  const original = expandScenarios().find((scenario) => scenario.id === id);
  const scenario = { ...original, viewport: { ...original.viewport, width } };
  const session = await newScenarioPage(browser, {
    scenario,
    origin: app.server.origin,
    locale,
    fixedNow: app.fixture.fixedNow,
    storageSeed: STORAGE_SEED,
  });
  // Keep real fixture projects/sessions and replace only the summary values.
  // Register before navigation so the first rendered summary uses the fixture.
  await session.context.route("**/api/get_project_stats_summary", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), ...SUMMARY } });
  });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: app.fixture, t });
  await session.page.goto(`${app.server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: "KPI fixture initial" });
  for (const step of scenario.screen.steps ?? []) await run(step);
  // Enlarge the statistics view after navigating to it. This measures the
  // tiles independently of unrelated mobile navigation at 200% root size.
  if (appScale !== 100) await run({ do: "fontScale", percent: appScale });
  await session.page.evaluate((scale) => {
    document.documentElement.style.fontSize = `${16 * scale}px`;
  }, rootScale);
  await settle(session, { label: "KPI fixture ready" });
  return Object.assign(session, { t });
}

const measure = (values) => values.evaluateAll((nodes) => nodes.map((value) => {
  const tile = value.parentElement;
  const card = tile.parentElement.parentElement.parentElement;
  const tileStyle = getComputedStyle(tile);
  const range = document.createRange();
  range.selectNodeContents(value);
  const number = range.getBoundingClientRect();
  const bounds = tile.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const innerLeft = bounds.left + parseFloat(tileStyle.borderLeftWidth) + parseFloat(tileStyle.paddingLeft);
  const innerRight = bounds.right - parseFloat(tileStyle.borderRightWidth) - parseFloat(tileStyle.paddingRight);
  // CJK fallback glyphs can have different tops on the same line. Count
  // overlapping vertical ranges, not identical glyph tops.
  const lines = [];
  for (const rect of [...range.getClientRects()].filter((r) => r.width > 0.3 && r.height > 0)) {
    const line = lines.find((l) => rect.top < l.bottom - 1 && rect.bottom > l.top + 1);
    if (line) {
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  return {
    text: value.textContent,
    label: tile.getAttribute("aria-label"),
    lines: lines.length,
    fontSize: parseFloat(getComputedStyle(value).fontSize),
    innerOverflow: Math.max(innerLeft - number.left, number.right - innerRight, 0),
    cardOverflow: Math.max(cardBounds.left - bounds.left, bounds.right - cardBounds.right, 0),
    top: bounds.top,
    width: bounds.width,
  };
}));

describe.skipIf(!ENABLED)("token KPI containment in real WebKit", () => {
  it.each(LOCALES)("%s: enlarged numbers fit without wrapping or shrinking", async (locale) => {
    for (const size of CASES) {
      const session = await openKpis(locale, size);
      try {
        const values = session.page.locator("button[aria-label] > div.font-mono");
        await values.first().scrollIntoViewIfNeeded();
        const metrics = await measure(values);
        const where = `${locale} ${JSON.stringify(size)}: ${JSON.stringify(metrics)}`;
        report.push({ locale, ...size, metrics });
        expect(metrics, where).toHaveLength(6);
        expect(metrics.at(-1).text, where).toBe("999,999");
        expect(metrics[0].label, where).toBe(`${session.t("analytics.totalTokens")}: 99,900,000`);
        for (const metric of metrics) {
          expect(metric.lines, where).toBe(1);
          expect(metric.innerOverflow, where).toBeLessThanOrEqual(1);
          expect(metric.cardOverflow, where).toBeLessThanOrEqual(1);
          expect(metric.fontSize, where).toBeCloseTo(24 * size.rootScale * size.appScale / 100, 1);
        }
        // Preserve normal density: the fix should not force every tile into
        // its own row when the usual mobile/desktop layout has enough room.
        if (size.rootScale === 1 && size.appScale === 100) {
          const firstRow = metrics.filter((metric) => Math.abs(metric.top - metrics[0].top) < 1);
          expect(firstRow.length, where).toBe(size.width === 1440 ? 5 : 2);
          if (size.width === 1440) {
            // A partially filled desktop row keeps the usual column width.
            for (const metric of metrics) expect(Math.abs(metric.width - metrics[0].width), where).toBeLessThanOrEqual(1);
          }
        }
        expect(session.log.pageErrors, where).toEqual([]);
      } finally {
        await session.close();
      }
    }
  }, 240_000);

  it("keeps the full value accessible from the keyboard and in the tooltip", async () => {
    const session = await openKpis("en", CASES[1]);
    try {
      // Tab between adjacent tiles so scrolling from an earlier section
      // cannot dismiss the tooltip while the target gains focus.
      const input = session.page.getByRole("button", { name: `${session.t("analytics.inputTokens")}: 999,900`, exact: true });
      await input.scrollIntoViewIfNeeded();
      expect(await keyboardFocus(session.page, input)).toBe(true);
      const tooltip = session.page.getByRole("tooltip");
      await tooltip.waitFor({ state: "visible" });
      expect(await tooltip.textContent()).toBe("999,900");
    } finally {
      await session.close();
    }
  }, 120_000);
});
