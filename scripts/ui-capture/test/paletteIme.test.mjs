// The ⌘K palette and IME composition (plan T10): a composition that starts
// over an already-typed query ends that query's message search. Its pending
// debounce is never sent, its answer in flight never becomes a row, and the
// Messages group waits for the composed text; composition end sends one
// search for what was composed.
//
// Real WebKit, the real production frontend and the worktree's server.
// WebKit has no IME driver, so the composition is the event sequence a
// browser IME produces (compositionstart, an input with isComposing,
// compositionend) dispatched on the field. Timers run on the page's virtual
// clock, so the debounce is stepped exactly. Skipped without WebKit or a
// built server.

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

/* global document, window, HTMLInputElement, CompositionEvent, InputEvent -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
const ENABLED = HAS_WEBKIT && HAS_SERVER;
if (!ENABLED) {
  console.warn(
    `[ui-capture] skipping paletteIme.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
  );
}

const SCENARIO = expandScenarios().find((s) => s.id === "palette-empty--1440x900--dark");
const LOCALE = "en";
const t = loadTranslator(REPO, LOCALE);
const SEARCH_PATH = /\/api\/search_(messages|all_providers)$/;

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-palette-ime-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `palette-ime-fixture-${process.pid}`);
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

/** The palette open on the large session, its field empty; search requests recorded. */
async function openPalette() {
  const session = await newScenarioPage(browser, {
    scenario: SCENARIO,
    origin: server.origin,
    locale: LOCALE,
    fixedNow: fixture.fixedNow,
    injections: SCENARIO.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(SCENARIO.screen.storage ?? {}) },
  });
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: "palette initial" });
  const run = createActions({ session, scenario: SCENARIO, manifest: fixture, t });
  for (const step of SCENARIO.screen.steps) await run(step);
  await settle(session, { label: "palette ready" });
  const searches = [];
  session.page.on("request", (request) => {
    if (SEARCH_PATH.test(new URL(request.url()).pathname)) searches.push(request.postDataJSON());
  });
  return { session, page: session.page, searches };
}

const field = (page) => page.getByRole("dialog").locator("input[role=combobox]");
const realWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** compositionstart, then the field showing `value` through a composing input. */
const composeTo = (page, value) =>
  page.evaluate((next) => {
    const el = document.querySelector("[role=dialog] input[role=combobox]");
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, next);
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText", data: next.slice(-1) }),
    );
  }, value);
const endComposition = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[role=dialog] input[role=combobox]");
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: el.value.slice(-1) }));
  });

const messageRows = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[role=dialog] [cmdk-item]"))
      .filter((el) => (el.getAttribute("data-value") ?? "").startsWith("message:"))
      .map((el) => ({ text: (el.textContent ?? "").slice(0, 80), selected: el.getAttribute("aria-selected") })),
  );
const dialogText = (page) => page.evaluate(() => document.querySelector("[role=dialog]")?.textContent ?? "");

describe.skipIf(!ENABLED)("⌘K palette: IME composition over a typed query (WebKit)", () => {
  it("a pending debounce of the typed query is never sent; composition end sends the composed text", async () => {
    const { session, page, searches } = await openPalette();
    try {
      await field(page).fill("reviewhello");
      await page.clock.runFor(80);
      await composeTo(page, "reviewhello로");
      await page.clock.runFor(400);
      await realWait(500);
      expect(searches).toEqual([]);
      expect(await dialogText(page)).toContain(t("globalSearch.messages.composing"));

      await endComposition(page);
      await page.clock.runFor(400);
      await expect.poll(() => searches.length, { timeout: 5_000 }).toBe(1);
      expect(searches[0]).toMatchObject({ query: "reviewhello로" });
    } finally {
      await session.close();
    }
  }, 120_000);

  it("the typed query's answer in flight never becomes a row under the composing text", async () => {
    const { session, page, searches } = await openPalette();
    const held = [];
    await page.route(SEARCH_PATH, (route) => {
      held.push(route);
    });
    try {
      await field(page).fill("reviewhello");
      await page.clock.runFor(300);
      await expect.poll(() => held.length, { timeout: 5_000 }).toBe(1);
      expect(searches[0]).toMatchObject({ query: "reviewhello" });

      await composeTo(page, "reviewhello로");
      await held[0].fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            uuid: "stale-1",
            sessionId: "stale-session",
            projectName: "stale-project",
            timestamp: "2026-01-01T00:00:00Z",
            type: "user",
            content: "reviewhello stale before IME",
          },
        ]),
      });
      await realWait(300);
      await page.clock.runFor(100);
      await realWait(200);
      expect(await messageRows(page)).toEqual([]);
      const text = await dialogText(page);
      expect(text).not.toContain("stale before IME");
      expect(text).toContain(t("globalSearch.messages.composing"));
      expect(held).toHaveLength(1);
    } finally {
      await session.close();
    }
  }, 120_000);
});
