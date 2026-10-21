// Copying a compact number gives the text Intl writes (F3b review 7). The
// formatter keeps `1120⁠万` on one line with U+2060 WORD JOINER; a numeric
// display copies it as `1120万` (`copyNumbersPlain`, `[data-number-copy]`),
// and the transcript copies exactly as recorded, a literal U+2060 included.
//
// Real WebKit and the real app (fixture HOME, pinned clock, the scenarios' own
// steps), like `compactNumberWrap.test.mjs`. The copy is the browser's own:
// `document.execCommand("copy")` over a selection fires the trusted copy
// event at the element the selection starts in, as ⌘C does. What the copy
// puts on the clipboard is read by a window listener that runs after the
// app's handlers: the text a handler set (default prevented), else the
// selection, which the browser then copies itself. That is the copy event's
// data, not the OS pasteboard. Skipped without WebKit or a built server.

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
const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "compactNumberCopy.test" }).enabled;

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));
const LOCALE = "ja";
/** Every screen that shows compact numbers: overview, Tokens, global stats, board, Inspector Tokens (with a transcript). */
const PLACES = [
  "analytics--1440x900--dark",
  "analytics-tokens--1440x900--dark",
  "global-stats--1440x900--dark",
  "board--1440x900--dark",
  "inspector-tokens--1440x900--dark",
];

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;
/** UI_COMPACT_COPY_REPORT=<file>: every joined number and boundary copy, per place. */
const report = [];

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-compact-copy-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `compact-copy-fixture-${process.pid}`);
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
  if (process.env.UI_COMPACT_COPY_REPORT && report.length > 0) {
    fs.writeFileSync(process.env.UI_COMPACT_COPY_REPORT, `${JSON.stringify(show(report), null, 2)}\n`);
  }
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
    locale: LOCALE,
    fixedNow: fixture.fixedNow,
    injections: scenario.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}) },
  });
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const run = createActions({ session, scenario, manifest: fixture, t: loadTranslator(REPO, LOCALE) });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return session;
}

/**
 * In the page: the copy helpers, installed once per page. `copyOf(node)`
 * selects the node's contents, copies, and returns what the copy carries.
 */
const installCopyProbe = (page) =>
  page.evaluate(() => {
    let last;
    window.addEventListener("copy", (event) => {
      last = {
        prevented: event.defaultPrevented,
        text: event.defaultPrevented ? event.clipboardData.getData("text/plain") : String(window.getSelection()),
      };
    });
    window.__copyOf = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const selected = String(selection);
      last = undefined;
      const ok = document.execCommand("copy");
      selection.removeAllRanges();
      return { ok, selected, ...(last ?? { fired: false }) };
    };
    // A numeral joined to a CJK suffix: what the formatter writes, and only that.
    window.__JOINED = /\d\u2060[\p{Script=Han}\p{Script=Hangul}]/u;
  });

/** Visible U+2060 in reports. */
const show = (value) => JSON.parse(JSON.stringify(value).replace(/\\u2060|\u2060/g, "<WJ>"));

describe.skipIf(!ENABLED)("copying compact numbers in WebKit (ja)", () => {
  it("every compact number a user can select sits in a copy boundary, which copies it without U+2060", async () => {
    for (const id of PLACES) {
      const session = await openScenario(id);
      try {
        await installCopyProbe(session.page);
        const { numbers, boundaries } = await session.page.evaluate(() => {
          const selectable = (node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const text = String(selection); // empty under user-select: none (the board)
            selection.removeAllRanges();
            return text !== "";
          };
          // Every rendered text node with a formatter-joined number: can it be selected, and does a boundary hold it?
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const numbers = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!window.__JOINED.test(node.textContent)) continue;
            if (node.parentElement.getClientRects().length === 0) continue; // not rendered
            numbers.push({
              text: node.textContent.trim(),
              selectable: selectable(node),
              inBoundary: !!node.parentElement.closest("[data-number-copy]"),
            });
          }
          // Copy each boundary that shows such a number, whole.
          const boundaries = [...document.querySelectorAll("[data-number-copy]")]
            .filter((element) => window.__JOINED.test(element.textContent) && element.getClientRects().length > 0)
            .map((element) => window.__copyOf(element));
          return { numbers, boundaries };
        });
        const where = `${LOCALE} ${id}`;
        if (process.env.UI_COMPACT_COPY_REPORT) report.push({ id, numbers, boundaries });
        const selectableNumbers = numbers.filter((n) => n.selectable);
        expect.soft(numbers.length, `${where}: compact numbers shown`).toBeGreaterThan(0);
        expect
          .soft(show(selectableNumbers.filter((n) => !n.inBoundary)), `${where}: a selectable compact number outside any copy boundary`)
          .toEqual([]);
        if (selectableNumbers.length > 0) expect.soft(boundaries.length, `${where}: boundaries copied`).toBeGreaterThan(0);
        for (const copied of boundaries) {
          // A boundary nobody can select would be dead code: each one copies, and the app handles it.
          expect.soft(show(copied), `${where}: copy fired and was handled`).toMatchObject({ ok: true, prevented: true });
          expect.soft(show(copied.text ?? ""), `${where}: copied text`).toBe(show(copied.selected.replace(/\u2060/g, "")));
        }
        if (id.startsWith("board--")) {
          // The board's lanes are select-none: nothing to copy there, so no boundary.
          expect.soft(selectableNumbers.length, `${where}: selectable compact numbers`).toBe(0);
        }
      } finally {
        await session.close();
      }
    }
  }, 300_000);

  it("the overview footer value copies as 1120万", async () => {
    const session = await openScenario("analytics--1440x900--dark");
    try {
      await installCopyProbe(session.page);
      const copied = await session.page.evaluate(() => {
        const value = [...document.querySelectorAll("[data-daily-trend-summary] span")].find((span) =>
          window.__JOINED.test(span.textContent),
        );
        return value ? window.__copyOf(value) : { missing: true };
      });
      expect(show(copied)).toEqual({ ok: true, selected: "1120<WJ>万", prevented: true, text: "1120万" });
    } finally {
      await session.close();
    }
  }, 120_000);

  it("transcript text with a literal U+2060 copies exactly as recorded", async () => {
    const session = await openScenario("inspector-tokens--1440x900--dark");
    try {
      await installCopyProbe(session.page);
      const copied = await session.page.evaluate(() => {
        // A recorded message: a literal joiner, also one shaped like a formatted number.
        const message = document.querySelector("[data-message-uuid]");
        if (!message) return { missing: true };
        const probe = document.createElement("span");
        probe.textContent = "recorded 1120\u2060万 and a\u2060b";
        message.append(probe);
        return { inBoundary: !!probe.closest("[data-number-copy]"), ...window.__copyOf(probe) };
      });
      expect(show(copied)).toEqual({
        inBoundary: false,
        ok: true,
        selected: "recorded 1120<WJ>万 and a<WJ>b",
        prevented: false,
        text: "recorded 1120<WJ>万 and a<WJ>b",
      });
    } finally {
      await session.close();
    }
  }, 120_000);
});
