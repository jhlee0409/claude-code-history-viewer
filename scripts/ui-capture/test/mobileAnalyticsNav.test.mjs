// The phone's analytics nav row (Overview · Tokens · Edits, owner decision)
// fits, in every locale, at 390 and 360 px; and the dashboard's Project
// overview | Session details row with the date filter never clips.
//
// Real WebKit, the real app and the harness scenarios (fixture HOME, pinned
// clock, the scenarios' own steps), like `inspectorWrap.test.mjs`. For each
// place the row reaches it asserts: exactly one navigation row above the
// screen body (no analytics sub-tabs stacked under it), the current place
// marked, every item's label fully visible (no ellipsis, no overflow) and the
// row inside the viewport. On the overview it asserts that nothing in the
// controls row (Project overview | Session details + date filter) reaches
// past the content box, and records whether the filter shares the line
// (printed; the layout wraps it, left-aligned, when it does not fit).
// Skipped without WebKit or without a built server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { buildDist } from "../lib/viteBuild.mjs";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator, SUPPORTED_LOCALES } from "../lib/i18n.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";

/* global document, window, getComputedStyle -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
const ENABLED = HAS_WEBKIT && HAS_SERVER;
if (!ENABLED) {
  console.warn(
    `[ui-capture] skipping mobileAnalyticsNav.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
  );
}

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));
const WIDTHS = [390, 360];
/** Scenario → the nav item that must be current there. */
const PLACES = [
  ["analytics", "overview"],
  ["analytics-tokens", "tokens"],
  ["recent-edits", "edits"],
];

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;
const lineReport = [];

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-mobile-nav-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `mobile-nav-fixture-${process.pid}`);
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
  // UI_MOBILE_NAV_REPORT=<file>: where the date filter landed, per locale and width.
  if (process.env.UI_MOBILE_NAV_REPORT && lineReport.length > 0) {
    fs.writeFileSync(process.env.UI_MOBILE_NAV_REPORT, `${lineReport.sort().join("\n")}\n`);
  }
  await browser?.close();
  await server?.stop();
  for (const dir of [dist, fixtureRoot]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function openScenario(id, { locale, width }) {
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
  if (width !== scenario.viewport.width) {
    await session.page.setViewportSize({ width, height: scenario.viewport.height });
  }
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return session;
}

const measureNav = (page) =>
  page.evaluate(() => {
    const main = document.getElementById("main-content");
    const navs = Array.from(main.querySelectorAll("nav, [role=navigation]"));
    const nav = main.querySelector("[data-mobile-analytics-nav]");
    const body = main.querySelector("[data-slot=view-panel], [role=tabpanel]") ?? null;
    const items = nav
      ? Array.from(nav.querySelectorAll("button")).map((b) => {
          const r = b.getBoundingClientRect();
          return {
            place: b.getAttribute("data-analytics-place"),
            current: b.getAttribute("aria-current"),
            label: b.textContent,
            scrollWidth: b.scrollWidth,
            clientWidth: b.clientWidth,
            left: r.left,
            right: r.right,
          };
        })
      : [];
    return {
      navCount: navs.length,
      subTabs: main.querySelectorAll("[data-analytics-tab]").length,
      hasBody: body != null,
      viewport: window.innerWidth,
      items,
    };
  });

const measureControls = (page) =>
  page.evaluate(() => {
    const row = document.querySelector("[data-analytics-controls]");
    if (!row) return null;
    const box = row.getBoundingClientRect();
    const children = Array.from(row.children).map((el) => el.getBoundingClientRect());
    const overflow = Array.from(row.querySelectorAll("*"))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter(({ r }) => r.right > box.right + 0.5 || r.left < box.left - 0.5)
      .map(({ el }) => el.outerHTML.slice(0, 80));
    const clipped = Array.from(row.querySelectorAll("button, span"))
      .filter((el) => el.scrollWidth > el.clientWidth + 0.5 && el.clientWidth > 0)
      .map((el) => el.textContent);
    return {
      width: box.width,
      count: children.length,
      // Items are centred on the cross axis, so "same line" is overlap, not equal tops.
      oneLine: children.every((r) => r.top < children[0].bottom && r.bottom > children[0].top),
      // The filter (last child) when it starts a line of its own.
      filterOffset: children[children.length - 1].left - box.left,
      // Flex items of a wrapping row are as wide as their content.
      childWidths: children.map((r) => r.width),
      overflow,
      clipped,
    };
  });

describe.skipIf(!ENABLED)("phone analytics nav row in WebKit", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of WIDTHS) {
      it(`${locale} @${width}: one row, current place marked, every label fits`, async () => {
        const t = loadTranslator(REPO, locale);
        for (const [screenId, place] of PLACES) {
          const session = await openScenario(`${screenId}--390x844--light`, { locale, width });
          const { page } = session;
          try {
            const where = `${locale} @${width} ${screenId}`;
            const nav = await measureNav(page);
            expect(nav.viewport, where).toBe(width);
            expect(nav.navCount, `${where}: navigation rows in the main column`).toBe(1);
            expect(nav.subTabs, `${where}: analytics sub-tabs stacked under the row`).toBe(0);
            expect(nav.items.map((i) => i.place), where).toEqual(["overview", "tokens", "edits"]);
            expect(nav.items.map((i) => i.label), where).toEqual([
              t("analytics.subTab.overview"),
              t("analytics.subTab.tokens"),
              t("recentEdits.title"),
            ]);
            expect(nav.items.filter((i) => i.current === "page").map((i) => i.place), where).toEqual([place]);
            for (const item of nav.items) {
              expect(item.scrollWidth, `${where}: "${item.label}" clipped`).toBeLessThanOrEqual(item.clientWidth);
              expect(item.left, `${where}: "${item.label}" off screen`).toBeGreaterThanOrEqual(0);
              expect(item.right, `${where}: "${item.label}" off screen`).toBeLessThanOrEqual(width);
            }
            if (screenId === "analytics") {
              const controls = await measureControls(page);
              expect(controls, `${where}: controls row`).not.toBeNull();
              expect(controls.overflow, `${where}: past the content box`).toEqual([]);
              expect(controls.clipped, `${where}: clipped labels`).toEqual([]);
              if (controls.count === 1 || !controls.oneLine) {
                expect(controls.filterOffset, `${where}: a filter on its own line sits left, not right`).toBeLessThan(1);
              }
              const widths = controls.childWidths.map((w) => Math.round(w)).join(" + ");
              lineReport.push(
                `${locale} @${width}: ${controls.count > 1 ? (controls.oneLine ? "same line" : "wrapped") : "filter only"} (${widths} in ${Math.round(controls.width)})`,
              );
            }
          } finally {
            await session.close();
          }
        }
      }, 240_000);
    }
  }
});
