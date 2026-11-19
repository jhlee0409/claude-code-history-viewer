// The real app for a real-browser test: a production build (or a prebuilt
// dist from UI_TEST_DIST, e.g. a base commit's build to show a test is red
// there), the fixture HOME inside the checkout (the app hides projects
// under the system temp dir), the harness server, and the scenario's own
// steps. Used by the F1b base-layer tests (motion, forced colours,
// contrast, CJK, focus ring).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDist } from "../lib/viteBuild.mjs";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator } from "../lib/i18n.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));

/** Start the app once per test file. `stop()` removes what it made. */
export async function startApp(label) {
  const prebuilt = process.env.UI_TEST_DIST ? path.resolve(process.env.UI_TEST_DIST) : null;
  const dist = prebuilt ?? buildDist(`cchv-${label}-`);
  const fixtureRoot = path.join(REPO, ".ui-capture", `${label}-fixture-${process.pid}`);
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const fixture = generateFixture({ root: fixtureRoot });
  const server = await startServer({
    binary: SERVER_BIN,
    dist,
    home: fixture.home,
    fixtureRoot,
    logFile: path.join(fixtureRoot, "server.log"),
  });
  return {
    dist,
    fixture,
    server,
    async stop() {
      await server.stop();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      if (!prebuilt) fs.rmSync(dist, { recursive: true, force: true });
    },
  };
}

/**
 * Open scenario `id` (e.g. "transcript--1440x900--dark") with its steps run.
 * `storage` is laid over the scenario's seed; `variant` picks motion,
 * forced colours, contrast, live mode (lib/variant.mjs).
 */
export async function openScenario(browser, app, id, { locale = "en", variant = {}, storage = {} } = {}) {
  const scenario = SCENARIOS.get(id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const session = await newScenarioPage(browser, {
    scenario,
    origin: app.server.origin,
    locale,
    fixedNow: app.fixture.fixedNow,
    injections: scenario.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}), ...storage },
    variant,
  });
  await session.page.goto(`${app.server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: app.fixture, t });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return Object.assign(session, { t });
}

/**
 * Keyboard focus on `target`: focus the control before it, then Tab
 * (Alt+Tab in WebKit, whose plain Tab skips buttons). Keyboard modality
 * makes `:focus-visible` match, as for a user.
 */
export async function keyboardFocus(page, target) {
  await target.evaluate((el) => {
    const focusable = Array.from(
      document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((node) => !node.disabled && node.getClientRects().length > 0 && node.tabIndex >= 0);
    const index = focusable.indexOf(el);
    if (index < 1) throw new Error("no focusable control before the target");
    focusable[index - 1].focus();
  });
  const engine = page.context().browser()?.browserType().name() ?? "webkit";
  await page.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
  return target.evaluate((el) => document.activeElement === el);
}

/* global document */
