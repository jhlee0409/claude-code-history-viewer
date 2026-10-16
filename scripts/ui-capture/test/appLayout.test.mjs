// Layout of the real app in real WebKit (design-polish fixes). jsdom has no
// layout, and the default captures show each defect only as pixels; these
// checks measure them. Each check opens a harness scenario the same way the
// capture run does (fixture HOME, pinned clock, the scenario's own steps),
// against a fresh `vite build` of this checkout and the harness's server
// binary. Skipped without WebKit or without a built server
// (`pnpm ui:capture` builds `.ui-capture/build/cchv-server`).
//
// - Settings on a phone: the editor footer (mode toggle, reset, save) never
//   overlaps the "what's active" summary, and both can be scrolled fully
//   above the bottom tab bar.

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

/* global document, window -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
const ENABLED = HAS_WEBKIT && HAS_SERVER;
if (!ENABLED) {
  console.warn(
    `[ui-capture] skipping appLayout.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
  );
}

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-app-layout-");
  // Inside the checkout like the harness's own fixture: the app hides
  // projects under the system temp dir, so an os.tmpdir() home lists none.
  fixtureRoot = path.join(REPO, ".ui-capture", `app-layout-fixture-${process.pid}`);
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
  await browser?.close();
  await server?.stop();
  for (const dir of [dist, fixtureRoot]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** Open a harness scenario (by id) in a locale, run its steps, settle. */
async function openScenario(id, { locale = "ko", storage = {} } = {}) {
  const scenario = SCENARIOS.get(id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const session = await newScenarioPage(browser, {
    scenario,
    origin: server.origin,
    locale,
    fixedNow: fixture.fixedNow,
    injections: scenario.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}), ...storage },
  });
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return { session, page: session.page, t };
}

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const rectOf = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });

describe.skipIf(!ENABLED)("app layout in WebKit", () => {
  it("phone settings: editor footer and active-settings summary never overlap, both clear the tab bar", async () => {
    const { session, page, t } = await openScenario("settings--390x844--light");
    try {
      const save = page.getByRole("button", { name: t("settingsManager.unified.footer.save"), exact: true });
      const reset = page.getByRole("button", { name: t("settingsManager.unified.footer.reset"), exact: true });
      const visual = page.getByRole("button", { name: t("settingsManager.mode.visual"), exact: true });
      const summary = page.getByText(t("settingsManager.unified.banner.whatsActive")).first();
      const tabBar = page
        .getByRole("navigation")
        .filter({ has: page.getByRole("button", { name: t("common.mobile.tab.settings"), exact: true }) });

      const summaryBox = await rectOf(summary);
      for (const control of [save, reset, visual]) {
        const box = await rectOf(control);
        expect(box.height).toBeGreaterThan(0);
        expect(overlapArea(box, summaryBox)).toBe(0);
      }
      const barTop = (await rectOf(tabBar)).top;
      for (const target of [save, summary]) {
        await target.scrollIntoViewIfNeeded();
        const box = await rectOf(target);
        expect(box.bottom).toBeLessThanOrEqual(barTop);
        expect(box.top).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await session.close();
    }
  }, 120_000);

});
