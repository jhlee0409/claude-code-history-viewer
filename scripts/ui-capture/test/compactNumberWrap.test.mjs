// A compact token amount never splits from its magnitude suffix (F3b review
// 6). CJK suffixes (万 萬 億 亿 만 억) are ideographs or Hangul syllables, and
// Unicode line breaking allows a break between a digit and those, so in a
// narrow box `1120万` wrapped as `1120` / `万` (ja, project overview footer at
// 390 px). Latin `11.2M` never did: a digit and a letter do not break.
//
// Real WebKit, the real app and the harness scenarios (fixture HOME, pinned
// clock, the scenarios' own steps), like `mobileAnalyticsNav.test.mjs`. On the
// overview (DailyTrendChart footer included) and the Tokens view
// (SessionStatsCard values included) every compact number in the main column
// must be one glyph line, counted from the DOM Range rects of its text, not
// from its element box. Each place must actually show compact numbers, so an
// empty page cannot pass. Skipped without WebKit or without a built server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { buildDist } from "../lib/viteBuild.mjs";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator } from "../lib/i18n.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global document, window, NodeFilter -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit/server into an error.
const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "compactNumberWrap.test" }).enabled;

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));
const LOCALES = ["ja", "zh-TW"];
const WIDTH = 390;
/** Scenario → the component on it whose compact numbers must be present (data hook). */
const PLACES = [
  ["analytics--390x844--dark", "daily-trend-summary"],
  ["analytics-tokens--390x844--dark", "session-stats-card"],
];

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;
/** UI_COMPACT_WRAP_REPORT=<file>: every measured number, per locale and place. */
const report = [];

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-compact-wrap-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `compact-wrap-fixture-${process.pid}`);
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fixture = generateFixture({ root: fixtureRoot });
  server = await startServer({
    binary: SERVER_BIN,
    dist,
    home: fixture.home,
    fixtureRoot,
    logFile: path.join(fixtureRoot, "server.log"),
  });
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  if (process.env.UI_COMPACT_WRAP_REPORT && report.length > 0) {
    fs.writeFileSync(process.env.UI_COMPACT_WRAP_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  }
  await browser?.close();
  await server?.stop();
  for (const dir of [dist, fixtureRoot]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function openScenario(id, locale) {
  const scenario = SCENARIOS.get(id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const session = await newScenarioPage(browser, {
    scenario,
    origin: server.origin,
    locale,
    fixedNow: fixture.fixedNow,
    injections: scenario.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}) },
  });
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const run = createActions({ session, scenario, manifest: fixture, t: loadTranslator(REPO, locale) });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return session;
}

/**
 * Every compact number in the main column: its text, where it sits (the
 * component's data hook) and how many glyph lines its text occupies.
 */
const measureCompactNumbers = (page) =>
  page.evaluate(() => {
    // A compact amount with a magnitude suffix, with or without the U+2060
    // WORD JOINER the formatter puts between them.
    const COMPACT = /^-?\d[\d,.]*\u2060?[万萬億亿兆만억조천KMBT]$/u;
    // Rects on one line overlap vertically; tops differ between the Latin
    // digits and the CJK fallback font, so equal tops are not required.
    const lineCount = (rects) => {
      const lines = [];
      const visible = Array.from(rects).filter((r) => r.width > 0.5 && r.height > 0.5);
      for (const r of visible.sort((a, b) => a.top - b.top)) {
        const line = lines.find((l) => r.top < l.bottom - 1 && r.bottom > l.top + 1);
        if (line) {
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
        } else {
          lines.push({ top: r.top, bottom: r.bottom });
        }
      }
      return lines.length;
    };
    const main = document.getElementById("main-content");
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const values = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (!COMPACT.test(text)) continue;
      const element = node.parentElement;
      if (element.getClientRects().length === 0) continue; // not rendered
      const range = document.createRange();
      range.selectNodeContents(node);
      const owner = element.closest("[data-daily-trend-summary], [data-session-stats-card]");
      values.push({
        text: text.replace(/\u2060/g, "<WJ>"),
        place: owner?.hasAttribute("data-daily-trend-summary")
          ? "daily-trend-summary"
          : owner?.hasAttribute("data-session-stats-card")
            ? "session-stats-card"
            : "other",
        lines: lineCount(range.getClientRects()),
      });
    }
    return { viewport: window.innerWidth, values };
  });

describe.skipIf(!ENABLED)("compact numbers keep their magnitude suffix in WebKit", () => {
  for (const locale of LOCALES) {
    it(`${locale} @${WIDTH}: overview footer and session token cards, one line per number`, async () => {
      for (const [id, place] of PLACES) {
        const session = await openScenario(id, locale);
        try {
          const where = `${locale} ${id}`;
          const { viewport, values } = await measureCompactNumbers(session.page);
          if (process.env.UI_COMPACT_WRAP_REPORT) report.push({ locale, id, viewport, values });
          // Soft: one place failing still measures (and reports) the other.
          expect.soft(viewport, where).toBe(WIDTH);
          expect
            .soft(values.filter((v) => v.place === place).length, `${where}: compact numbers in ${place}`)
            .toBeGreaterThan(0);
          expect.soft(values.filter((v) => v.lines !== 1), `${where}: a compact number split across lines`).toEqual([]);
        } finally {
          await session.close();
        }
      }
    }, 240_000);
  }
});
