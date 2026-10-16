// The T7 sidebar in real WebKit, by keyboard and pointer. jsdom runs the
// tree's key handlers but has no focus model, layout or scrolling; here the
// keys are pressed for real against the built app (harness fixture HOME,
// pinned clock, the scenario's own steps). Skipped without WebKit or without
// a built server (`pnpm ui:capture` builds `.ui-capture/build/cchv-server`).
//
// - Session rows: ArrowDown moves focus to the next row, Enter opens it.
// - Option+Tab reaches the toolbar tablist (one roving stop, arrows walk
//   it), the gear and the library rows.
// - Row menu from the keyboard (Shift+F10 / ContextMenu): focus lands on the
//   first item, ArrowDown moves, Escape closes.
// - The row menu stays open while the transcript scrolls beside the sidebar
//   (it loads more and keeps its anchor on its own); a scroll that moves the
//   row (its scroll container) closes it.
// - Phone drawer: the row menu opens inside the drawer and takes the tap
//   (portalled to <body> the drawer covered it).

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

/* global document, getComputedStyle -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
const ENABLED = HAS_WEBKIT && HAS_SERVER;
if (!ENABLED) {
  console.warn(
    `[ui-capture] skipping sidebar.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
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
  dist = buildDist("cchv-sidebar-");
  // Inside the checkout like the harness's own fixture: the app hides
  // projects under the system temp dir, so an os.tmpdir() home lists none.
  fixtureRoot = path.join(REPO, ".ui-capture", `sidebar-fixture-${process.pid}`);
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
  return { session, page: session.page, t, run };
}

const SESSION_ROWS = '[role="tree"] [role="treeitem"][data-tree-node="session"]';
const focusedRowPath = (page) =>
  page.evaluate(() => document.activeElement?.closest("[data-session-path]")?.getAttribute("data-session-path") ?? null);

describe.skipIf(!ENABLED)("sidebar in WebKit", () => {
  it("session rows: ArrowDown moves focus, Enter opens; Shift+F10 menu: focus, ArrowDown, Escape", async () => {
    const { session, page } = await openScenario("sidebar-sessions--1440x900--dark");
    try {
      const rows = page.locator(SESSION_ROWS);
      expect(await rows.count()).toBeGreaterThan(1);
      const paths = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-session-path")));
      const selected = rows.and(page.locator('[aria-selected="true"]'));
      const openPath = await selected.first().getAttribute("data-session-path");
      const from = paths.indexOf(openPath);
      const next = paths[(from + 1) % paths.length];

      await selected.first().focus();
      await page.keyboard.press("ArrowDown");
      expect(await focusedRowPath(page)).toBe(next);
      await page.keyboard.press("Enter");
      await settle(session, { label: "open next session" });
      expect(await selected.first().getAttribute("data-session-path")).toBe(next);

      await page.locator(`${SESSION_ROWS}[data-session-path="${next}"]`).focus();
      await page.keyboard.press("Shift+F10");
      await settle(session, { label: "row menu" });
      const menu = page.getByRole("menu");
      expect(await menu.count()).toBe(1);
      const items = menu.getByRole("menuitem");
      const focusedItem = () => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].indexOf(document.activeElement));
      expect(await focusedItem()).toBe(0);
      await page.keyboard.press("ArrowDown");
      expect(await focusedItem()).toBe(1);
      expect(await items.count()).toBeGreaterThan(2);
      await page.keyboard.press("Escape");
      await settle(session, { label: "menu closed" });
      expect(await menu.count()).toBe(0);
    } finally {
      await session.close();
    }
  }, 120_000);

  // WebKit's Tab skips buttons (macOS default, as in the app's WKWebView);
  // Option+Tab reaches every control. The toolbar tabs are one roving stop:
  // Tab lands on the selected tab, the arrows move along the tablist.
  it("Option+Tab reaches the toolbar tablist, the gear and the library rows; arrows walk the tabs", async () => {
    const { session, page } = await openScenario("sidebar-sessions--1440x900--dark");
    try {
      await page.evaluate(() => document.activeElement?.blur());
      const reached = new Set();
      for (let i = 0; i < 80; i += 1) {
        await page.keyboard.press("Alt+Tab");
        const id = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          return (el.id && `#${el.id}`) || (el.getAttribute("data-library-item") && `library:${el.getAttribute("data-library-item")}`);
        });
        if (id) reached.add(id);
      }
      const expected = [
        "#view-tab-conversation",
        "#app-settings-button",
        "library:recent",
        "library:favorites",
        "library:archive",
        "library:settingsManager",
      ];
      expect(expected.filter((want) => !reached.has(want))).toEqual([]);
      // One tab stop for the tablist: no other view tab is reached by Tab.
      expect([...reached].filter((id) => id.startsWith("#view-tab-"))).toEqual(["#view-tab-conversation"]);

      await page.locator("#view-tab-conversation").focus();
      const walked = [];
      for (let i = 0; i < 4; i += 1) {
        walked.push(await page.evaluate(() => document.activeElement?.id));
        await page.keyboard.press("ArrowRight");
      }
      expect(walked).toEqual(["view-tab-conversation", "view-tab-analytics", "view-tab-edits", "view-tab-board"]);
    } finally {
      await session.close();
    }
  }, 120_000);

  it("row menu stays open while the transcript scrolls; closes when the row's container scrolls", async () => {
    const { session, page } = await openScenario("sidebar-sessions--1440x900--dark");
    try {
      const row = page.locator(SESSION_ROWS).first();
      await row.focus();
      await page.keyboard.press("Shift+F10");
      await settle(session, { label: "row menu" });
      const menu = page.getByRole("menu");
      expect(await menu.count()).toBe(1);

      // A real scroll of the transcript's own viewport.
      const moved = await page.evaluate(() => {
        const main = document.querySelector("#main-content");
        const scroller = [...(main?.querySelectorAll("*") ?? [])].find((el) => {
          const { overflowY } = getComputedStyle(el);
          return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 100;
        });
        if (!scroller) return null;
        const before = scroller.scrollTop;
        scroller.scrollTop = before > 400 ? before - 400 : before + 400;
        return scroller.scrollTop !== before;
      });
      expect(moved).toBe(true);
      await settle(session, { label: "transcript scrolled" });
      expect(await menu.count()).toBe(1);

      // The row's own scroll container scrolling moves the row: close.
      await row.evaluate((el) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const { overflowY } = getComputedStyle(node);
          if (overflowY === "auto" || overflowY === "scroll") {
            node.dispatchEvent(new Event("scroll"));
            return;
          }
        }
        document.dispatchEvent(new Event("scroll"));
      });
      await settle(session, { label: "sidebar scrolled" });
      expect(await menu.count()).toBe(0);
    } finally {
      await session.close();
    }
  }, 120_000);

  it("phone drawer: the row menu opens inside the drawer and takes the tap", async () => {
    const { session, page, t, run } = await openScenario("sidebar-sessions--390x844--light");
    try {
      await run({ do: "openSidebar" });
      const drawer = page.getByRole("dialog");
      const row = drawer.locator('[role="treeitem"][data-tree-node="session"]').first();
      await row.click({ button: "right" });
      await settle(session, { label: "row menu" });
      const menu = drawer.getByRole("menu");
      expect(await menu.count()).toBe(1);
      const add = menu.getByRole("menuitem", { name: t("session.favorite.add"), exact: true });
      // The menu item is the topmost element under its own centre.
      const hit = await add.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
      expect(hit).toBe(true);
      await add.click({ timeout: 5_000 });
      await settle(session, { label: "starred" });
      expect(await page.getByRole("menu").count()).toBe(0);
      expect(await drawer.count()).toBe(1);
    } finally {
      await session.close();
    }
  }, 120_000);
});
