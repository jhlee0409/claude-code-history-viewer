// Keyboard focus is visible on the shared segmented controls (T9b re-review
// P2). The base layer removes the browser outline (`:focus-visible {
// outline: none }`), so `.segmented-item:focus-visible` in index.css draws the
// one focus ring every segmented control relies on.
//
// Real WebKit, the real app and the harness scenarios (fixture HOME, pinned
// clock, the scenario's own steps). Focus arrives by keyboard (Alt+Tab walks
// every control in WebKit), so `:focus-visible` matches as it would for a
// user. For a selected item (the analytics sub-tabs' one tab stop) and an
// initially unselected one (the Edits screen's scope radios, reached by
// Tab to the checked entry then ArrowRight to select the target), in light,
// dark and both high-contrast themes, it asserts a 2px solid outline outside
// the item in the theme's accent, and that focusing moved nothing. Set
// UI_FOCUS_SHOTS_DIR to also save a screenshot of each focused control.
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
import { loadTranslator } from "../lib/i18n.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { focusScopeRadio, uncheckedScopeRadio } from "./segmentedKeyboard.mjs";

/* global document, getComputedStyle -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit/server into an error.
const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "segmentedFocus.test" }).enabled;
const SHOTS_DIR = process.env.UI_FOCUS_SHOTS_DIR ? path.resolve(process.env.UI_FOCUS_SHOTS_DIR) : null;

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-segmented-focus-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `segmented-focus-fixture-${process.pid}`);
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

async function openScenario(id) {
  const scenario = SCENARIOS.get(id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const session = await newScenarioPage(browser, {
    scenario,
    origin: server.origin,
    locale: "en",
    fixedNow: fixture.fixedNow,
    injections: scenario.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}) },
  });
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const t = loadTranslator(REPO, "en");
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return session;
}

/** Every segmented item's box in the main pane (layout-shift check). */
const itemRects = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#main-content .segmented-item")).map((el) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
    }),
  );

/**
 * Give `target` keyboard focus: focus the control before it, then Alt+Tab
 * (WebKit's Tab skips buttons; Alt+Tab walks every control). Keyboard
 * modality makes `:focus-visible` match.
 */
async function keyboardFocus(page, target) {
  await target.evaluate((el) => {
    const focusable = Array.from(
      document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((node) => !node.disabled && node.getClientRects().length > 0 && node.tabIndex >= 0);
    const index = focusable.indexOf(el);
    if (index < 1) throw new Error("no focusable control before the target");
    focusable[index - 1].focus();
  });
  await page.keyboard.press("Alt+Tab");
  return target.evaluate((el) => document.activeElement === el);
}

const focusStyle = (target) =>
  target.evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement("div");
    probe.style.color = "var(--accent)";
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      focusVisible: el.matches(":focus-visible"),
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      offset: cs.outlineOffset,
      color: cs.outlineColor,
      accent,
    };
  });

const THEME_CLASSES = [
  ["", ""],
  ["high contrast", "high-contrast"],
];

const CASES = [
  {
    name: "selected item (analytics sub-tab, the tablist's tab stop)",
    scenario: "analytics",
    target: (page) => page.locator('[data-analytics-tab][aria-selected="true"]'),
  },
  {
    name: "initially unselected item (Edits scope radio, arrow-selected)",
    scenario: "recent-edits",
    target: uncheckedScopeRadio,
    prepareFocus: (page, target) => focusScopeRadio(page, target, keyboardFocus),
  },
];

describe.skipIf(!ENABLED)("segmented controls show keyboard focus in WebKit", () => {
  for (const theme of ["light", "dark"]) {
    for (const c of CASES) {
      it(`${theme}: ${c.name}`, async () => {
        const session = await openScenario(`${c.scenario}--1440x900--${theme}`);
        const { page } = session;
        try {
          for (const [label, cls] of THEME_CLASSES) {
            if (cls) {
              await page.evaluate((name) => document.documentElement.classList.add(name), cls);
              await settle(session, { label: `${label} on` });
            }
            const target = await c.target(page);
            expect(await target.count(), "target control").toBeGreaterThan(0);
            if (c.prepareFocus) {
              expect(await c.prepareFocus(page, target), "arrow reaches the initially unchecked radio").toBe(true);
              // Radio arrows also change scope and its explanatory content.
              // Settle that selection first; the geometry contract below
              // measures focus alone, not an intentional scope-content change.
              await settle(session, { label: "radio selection ready" });
            }
            await page.evaluate(() => document.activeElement?.blur?.());
            const before = await itemRects(page);
            expect(before.length, "measured segmented controls").toBeGreaterThan(0);
            for (const [, , width, height] of before) {
              expect(width, "measured width").toBeGreaterThan(0);
              expect(height, "measured height").toBeGreaterThan(0);
            }
            expect(await keyboardFocus(page, target), `${theme} ${label}: focused`).toBe(true);
            const s = await focusStyle(target);
            const where = `${theme}${label ? ` ${label}` : ""}`;
            expect(s.focusVisible, `${where}: :focus-visible`).toBe(true);
            expect(s.style, `${where}: outline style`).toBe("solid");
            expect(s.width, `${where}: outline width`).toBe("2px");
            expect(s.offset, `${where}: outline offset`).toBe("1px");
            expect(s.color, `${where}: outline colour is the accent`).toBe(s.accent);
            expect(await itemRects(page), `${where}: focus moved nothing`).toEqual(before);
            if (SHOTS_DIR) {
              fs.mkdirSync(SHOTS_DIR, { recursive: true });
              const track = target.locator("xpath=..");
              const box = await track.boundingBox();
              const file = `${c.scenario}--${theme}${cls ? `-${cls}` : ""}.png`;
              await page.screenshot({
                path: path.join(SHOTS_DIR, file),
                clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 },
                animations: "disabled",
              });
            }
          }
        } finally {
          await session.close();
        }
      }, 120_000);
    }
  }
});
