// Conversation tabs and keyboard focus in real WebKit (T8 review #8, WCAG
// 2.4.3). jsdom has no focus model to speak of; here the keys are pressed
// for real against the built app (harness fixture HOME, pinned clock, the
// scenarios' own steps). Skipped without WebKit or without a built server
// (`pnpm ui:capture` builds `.ui-capture/build/cchv-server`).
//
// - Strip: Delete on a focused tab moves focus to the tab that takes its
//   place (right neighbour, else left); closing the open tab with the WebUI
//   close key (⌥W) from the strip keeps focus on a tab, not the page.
// - Phone sheet: opened from the toolbar's tab count with the keyboard,
//   Escape closes it and focus is back on the count button; opening a tab
//   from the list does the same.

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

/* global document */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
const ENABLED = HAS_WEBKIT && HAS_SERVER;
if (!ENABLED) {
  console.warn(
    `[ui-capture] skipping tabsFocus.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
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
  dist = buildDist("cchv-tabsfocus-");
  // Inside the checkout like the harness's own fixture: the app hides
  // projects under the system temp dir, so an os.tmpdir() home lists none.
  fixtureRoot = path.join(REPO, ".ui-capture", `tabsfocus-fixture-${process.pid}`);
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

/** Open a harness scenario (by id), run its steps, settle. */
async function openScenario(id, { locale = "en" } = {}) {
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
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return { session, page: session.page };
}

const STRIP_TABS = '[data-slot="tabs"] [role="tab"]';
const tabIds = (page) => page.locator(STRIP_TABS).evaluateAll((els) => els.map((el) => el.getAttribute("data-document-id")));
const focusedTabId = (page) =>
  page.evaluate(() => (document.activeElement?.getAttribute("role") === "tab" ? document.activeElement.getAttribute("data-document-id") : null));

describe.skipIf(!ENABLED)("conversation tabs and focus in WebKit", () => {
  it("strip: Delete moves focus to the tab taking the closed one's place; ⌥W keeps focus on a tab", async () => {
    const { session, page } = await openScenario("tabs-three--1440x900--dark");
    try {
      const ids = await tabIds(page);
      expect(ids).toHaveLength(3);

      // The middle tab (not the open one): its right neighbour takes focus.
      await page.locator(`${STRIP_TABS}[data-document-id="${ids[1]}"]`).focus();
      await page.keyboard.press("Delete");
      await settle(session, { label: "closed middle tab" });
      expect(await tabIds(page)).toEqual([ids[0], ids[2]]);
      expect(await focusedTabId(page)).toBe(ids[2]);

      // The open tab, closed with the WebUI close key from the strip.
      await page.locator(`${STRIP_TABS}[aria-selected="true"]`).focus();
      await page.keyboard.press("Alt+KeyW");
      await settle(session, { label: "closed open tab" });
      expect(await tabIds(page)).toEqual([ids[2]]);
      expect(await focusedTabId(page)).toBe(ids[2]);
    } finally {
      await session.close();
    }
  }, 120_000);

  it("phone sheet: Escape and opening a tab give focus back to the tab-count button", async () => {
    const { session, page } = await openScenario("tabs-mobile--390x844--dark");
    try {
      const count = page.locator("[data-mobile-tabs]");
      const countFocused = () => page.evaluate(() => document.activeElement?.hasAttribute("data-mobile-tabs") ?? false);

      await count.focus();
      await page.keyboard.press("Enter");
      await settle(session, { label: "sheet open" });
      const dialog = page.getByRole("dialog");
      expect(await dialog.count()).toBe(1);
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await settle(session, { label: "sheet closed (Escape)" });
      expect(await dialog.count()).toBe(0);
      expect(await countFocused()).toBe(true);

      await page.keyboard.press("Enter");
      await settle(session, { label: "sheet open again" });
      await dialog.getByRole("listitem").first().getByRole("button").first().click();
      await settle(session, { label: "tab opened from the sheet" });
      expect(await dialog.count()).toBe(0);
      expect(await countFocused()).toBe(true);
    } finally {
      await session.close();
    }
  }, 120_000);
});
