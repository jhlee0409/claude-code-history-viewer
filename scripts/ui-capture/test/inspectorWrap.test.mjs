// The inspector's text never wraps inside a word (T9a design review): at
// the default (280px) and the minimum (200px) inspector width, in every
// locale, on the Tokens and Info tabs and the tab strip.
//
// Real WebKit, the real app and the harness scenario (fixture HOME, pinned
// clock, the scenario's own steps), like `appLayout.test.mjs`. For every
// visible text run in the inspector it measures each whitespace-separated
// word with a DOM Range: a word whose boxes sit on more than one line was
// broken inside it (the first Tokens tab wrapped "출력 토큰" one character
// per line). A run wider than the whole panel may wrap (a Chinese or
// Japanese sentence has no spaces). Text that opts into breaking anywhere (`word-break:
// break-all`: ids, file paths) is exempt, as is the outline (the message
// navigator, moved as is). A tab label that does not fit is a finding too.
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
import { STORAGE_SEED, expandScenarios, inspectorStorage } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global document, getComputedStyle, NodeFilter -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit/server into an error.
const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "inspectorWrap.test" }).enabled;

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));
/** The inspector's default and minimum widths (`inspectorSlice.ts`). */
const WIDTHS = [280, 200];
const TABS = ["tokens", "info"];

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-inspector-wrap-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `inspector-wrap-fixture-${process.pid}`);
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

async function openInspector({ tab, width, locale }) {
  const id = `inspector-${tab}--1440x900--dark`;
  const scenario = SCENARIOS.get(id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const session = await newScenarioPage(browser, {
    scenario,
    origin: server.origin,
    locale,
    fixedNow: fixture.fixedNow,
    injections: scenario.screen.inject,
    storageSeed: { ...STORAGE_SEED, ...scenario.screen.storage, ...inspectorStorage({ open: true, tab, width }) },
  });
  await session.page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await settle(session, { label: `${id} initial` });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps ?? []) await run(step);
  await settle(session, { label: `${id} ready` });
  return session;
}

/** Words broken across lines, and tab labels that do not fit, in the inspector. */
function measureWraps() {
  const root = document.getElementById("inspector");
  if (!root) return { width: null, words: 0, findings: ["no inspector"] };
  const findings = [];
  let words = 0;
  // The panel's width less the tab bodies' padding (p-3).
  const available = root.clientWidth - 24;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest("#message-navigator") || !el.checkVisibility()) continue;
    if (getComputedStyle(el).wordBreak === "break-all") continue;
    const text = node.textContent ?? "";
    for (const match of text.matchAll(/\S+/g)) {
      if (match[0].length < 2) continue;
      words += 1;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const lines = new Set(rects.map((r) => Math.round(r.top)));
      // A run wider than the whole panel (a CJK sentence has no spaces)
      // has to wrap; anything narrower had room for one line.
      const naturalWidth = rects.reduce((sum, r) => sum + r.width, 0);
      if (lines.size > 1 && naturalWidth <= available) {
        findings.push(`"${match[0]}" wraps over ${lines.size} lines`);
      }
    }
  }
  for (const tab of root.querySelectorAll('[role="tab"]')) {
    if (tab.scrollWidth > tab.clientWidth + 1) findings.push(`tab "${tab.textContent}" is cut off`);
  }
  return { width: Math.round(root.getBoundingClientRect().width), words, findings };
}

describe.skipIf(!ENABLED)("inspector text in WebKit", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of WIDTHS) {
      for (const tab of TABS) {
        it(`${tab} tab, ${width}px, ${locale}: no word wraps inside itself`, async () => {
          const session = await openInspector({ tab, width, locale });
          try {
            const result = await session.page.evaluate(measureWraps);
            expect(result.width).toBe(width);
            // The tab actually rendered its content (not a loading state).
            expect(result.words).toBeGreaterThan(10);
            expect(result.findings).toEqual([]);
          } finally {
            await session.close();
          }
        }, 120_000);
      }
    }
  }
});
