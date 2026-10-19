// The ⌘K palette fits a phone (plan T10): at 390 and 360 px, in every
// locale, with a query that fills every group, nothing in the palette
// reaches past the dialog - the filter bar wraps instead of pushing the scope
// chip out, and long rows (a session title, a project's folders) end in an
// ellipsis inside the dialog. A grid dialog sizes its cmdk root to the
// widest row unless that root may shrink (`min-w-0`); the base palette ran
// off the screen that way.
//
// Real WebKit, the real app and the harness scenario's own steps, like
// `mobileAnalyticsNav.test.mjs`. Skipped without WebKit or a built server.

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
import { browserRequirement } from "./requirements.mjs";

/* global document, window -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit/server into an error.
const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "paletteFit.test" }).enabled;

const SCENARIO = expandScenarios().find((s) => s.id === "palette-all-groups--390x844--dark");
const WIDTHS = [390, 360];

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-palette-fit-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `palette-fit-fixture-${process.pid}`);
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

async function openPalette({ locale, width }) {
  const session = await newScenarioPage(browser, {
    scenario: SCENARIO,
    origin: server.origin,
    locale,
    fixedNow: fixture.fixedNow,
    injections: SCENARIO.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(SCENARIO.screen.storage ?? {}) },
  });
  if (width !== SCENARIO.viewport.width) {
    await session.page.setViewportSize({ width, height: SCENARIO.viewport.height });
  }
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: "palette initial" });
  const run = createActions({ session, scenario: SCENARIO, manifest: fixture, t: loadTranslator(REPO, locale) });
  for (const step of SCENARIO.screen.steps) await run(step);
  await settle(session, { label: "palette ready" });
  return session;
}

const measure = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector("[role=dialog]");
    const box = dialog.getBoundingClientRect();
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, label: (el.textContent ?? "").trim().slice(0, 40) };
    };
    const chips = Array.from(dialog.querySelectorAll(".segmented-item")).map((el) => ({
      ...rect(el),
      clipped: el.scrollWidth > el.clientWidth,
    }));
    return {
      viewport: window.innerWidth,
      dialog: { left: box.left, right: box.right },
      root: rect(dialog.querySelector("[cmdk-root]")),
      chips,
      rows: Array.from(dialog.querySelectorAll("[cmdk-item]")).map(rect),
      groups: Array.from(dialog.querySelectorAll("[cmdk-group-heading]")).length,
    };
  });

describe.skipIf(!ENABLED)("⌘K palette on a phone", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of WIDTHS) {
      it(`${locale} @${width}: every group shows and nothing runs past the dialog`, async () => {
        const session = await openPalette({ locale, width });
        try {
          const m = await measure(session.page);
          // Commands, Projects, Sessions, Messages.
          expect(m.groups).toBe(4);
          expect(m.dialog.left).toBeGreaterThanOrEqual(0);
          expect(m.dialog.right).toBeLessThanOrEqual(m.viewport);
          expect(m.root.right).toBeLessThanOrEqual(m.dialog.right + 0.5);
          expect(m.chips).toHaveLength(2);
          for (const chip of m.chips) {
            expect(chip.clipped, `${chip.label} clipped`).toBe(false);
            expect(chip.right, `${chip.label} past the dialog`).toBeLessThanOrEqual(m.dialog.right);
          }
          for (const row of m.rows) {
            expect(row.right, `row "${row.label}" past the dialog`).toBeLessThanOrEqual(m.dialog.right + 0.5);
          }
        } finally {
          await session.close();
        }
      }, 120_000);
    }
  }
});
