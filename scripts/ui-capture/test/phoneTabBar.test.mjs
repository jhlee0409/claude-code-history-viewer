// The phone tab bar names every place by its one name, the Settings Manager
// included ("Claude Code Settings", owner decision 2026-10-17) and the board
// by its full name ("Session board", "セッションボード"), and fits them
// in every locale at 390 and 360 px. Phone fit is solved by layout (the label
// may take two lines, at the caption size, never under 12 px), never by a
// shorter name.
//
// Real WebKit, the real app and the harness scenarios (fixture HOME, pinned
// clock, the scenarios' own steps), like `mobileAnalyticsNav.test.mjs`. For
// each tab it asserts: the button's accessible name and visible label are the
// place name, the label is not clipped (no ellipsis, no line clamp hiding
// text, nothing past its button), it is at least 12 px, it takes at most two
// lines, the label box and its glyph lines sit wholly inside the bar, the tap
// height is at least 44 px, the current-tab marker clears icon and label, the button sits inside the bar and the viewport,
// and the page is no wider than the viewport (WebKit would otherwise draw a
// horizontal scrollbar over the bar), and neighbouring labels keep a gap.
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
    `[ui-capture] skipping phoneTabBar.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
  );
}

const SCENARIOS = new Map(expandScenarios().map((scenario) => [scenario.id, scenario]));
const WIDTHS = [390, 360];
/** The settings screen (its tab current) and a transcript (a project open). */
const SCREENS = ["settings", "transcript"];

/** The tab bar's i18n keys, in order (`BottomTabBar`). */
const TAB_KEYS = [
  "common.mobile.tab.projects",
  "common.place.messages",
  "common.place.board",
  "common.place.analytics",
  "common.place.claudeCodeSettings",
];

/** CSS px between the glyphs of neighbouring tab labels. */
const MIN_LABEL_GAP = 4;

/**
 * The board's one name, per locale: the full name, not a phone short form
 * ("Board" / "ボード" were short names for the old one-line bar).
 */
const SESSION_BOARD = {
  en: "Session board",
  ko: "세션 보드",
  ja: "セッションボード",
  "zh-CN": "会话面板",
  "zh-TW": "會話面板",
};

/** The owner's name for the Settings Manager, per locale. */
const CLAUDE_CODE_SETTINGS = {
  en: "Claude Code Settings",
  ko: "Claude Code 설정",
  ja: "Claude Code 設定",
  "zh-CN": "Claude Code 设置",
  "zh-TW": "Claude Code 設定",
};

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;
const report = [];

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-phone-tabs-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `phone-tabs-fixture-${process.pid}`);
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
  // UI_PHONE_TABS_REPORT=<file>: label lines and widths per locale and width.
  if (process.env.UI_PHONE_TABS_REPORT && report.length > 0) {
    fs.writeFileSync(process.env.UI_PHONE_TABS_REPORT, `${report.sort().join("\n")}\n`);
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

const measureTabBar = (page) =>
  page.evaluate(() => {
    // The bar marks itself; a build before that is found as the fixed nav at the bottom.
    const nav =
      document.querySelector("[data-mobile-tab-bar]") ??
      Array.from(document.querySelectorAll("nav")).find(
        (n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().bottom >= window.innerHeight - 1,
      );
    if (!nav) return null;
    const navBox = nav.getBoundingClientRect();
    const tabs = Array.from(nav.querySelectorAll("button")).map((button) => {
      const box = button.getBoundingClientRect();
      const label = button.querySelector("[data-tab-label]") ?? button.querySelector("span");
      const labelBox = label?.getBoundingClientRect();
      const cs = label ? getComputedStyle(label) : null;
      const lineHeight = cs ? parseFloat(cs.lineHeight) : 0;
      // Everything drawn inside the button, the icon and any sub-label too.
      const parts = Array.from(button.querySelectorAll("*"))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getBoundingClientRect());
      // The glyph lines of the label, as laid out.
      const range = document.createRange();
      if (label) range.selectNodeContents(label);
      const textRects = label
        ? Array.from(range.getClientRects()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }))
        : [];
      const rectOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        indicator: rectOf(button.querySelector("[data-tab-indicator]")),
        icon: rectOf(button.querySelector("svg")),
        textRects,
        labelBox: labelBox ? { top: labelBox.top, bottom: labelBox.bottom, left: labelBox.left, right: labelBox.right } : null,
        name: button.getAttribute("aria-label"),
        label: label?.textContent ?? null,
        fontSize: cs ? parseFloat(cs.fontSize) : 0,
        lines: label && lineHeight > 0 ? Math.round(label.scrollHeight / lineHeight) : 0,
        clippedX: label ? label.scrollWidth > label.clientWidth + 0.5 : true,
        clippedY: label ? label.scrollHeight > label.clientHeight + 0.5 : true,
        heights: label ? `${label.scrollHeight}/${label.clientHeight} (line ${lineHeight})` : "",
        // The label's longest unbroken run, measured on one line.
        textWidth: (() => {
          if (!label) return 0;
          const probe = label.cloneNode(true);
          probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;width:auto;max-width:none";
          button.appendChild(probe);
          const w = probe.getBoundingClientRect().width;
          probe.remove();
          return w;
        })(),
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width },
        outside: parts.filter(
          (r) => r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5,
        ).length,
      };
    });
    return {
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      // Anything wider than the viewport makes WebKit draw a horizontal
      // scrollbar over the bottom of the page, i.e. over the tab bar.
      pageWidth: document.documentElement.scrollWidth,
      nav: { left: navBox.left, right: navBox.right, top: navBox.top, bottom: navBox.bottom, height: navBox.height },
      tabs,
    };
  });

describe.skipIf(!ENABLED)("phone tab bar in WebKit", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of WIDTHS) {
      it(`${locale} @${width}: every tab shows its place name in full, Session board and Claude Code Settings included`, async () => {
        const t = loadTranslator(REPO, locale);
        for (const screenId of SCREENS) {
          const session = await openScenario(`${screenId}--390x844--light`, { locale, width });
          try {
            const where = `${locale} @${width} ${screenId}`;
            const bar = await measureTabBar(session.page);
            expect(bar, `${where}: tab bar`).not.toBeNull();
            expect(bar.viewport, where).toBe(width);
            const names = TAB_KEYS.map((key) => t(key));
            expect(bar.tabs.map((tab) => tab.name), where).toEqual(names);
            expect(bar.tabs.map((tab) => tab.label), where).toEqual(names);
            expect(bar.tabs[2].label, where).toBe(SESSION_BOARD[locale]);
            expect(bar.tabs[4].label, where).toBe(CLAUDE_CODE_SETTINGS[locale]);
            expect(bar.pageWidth, `${where}: page wider than the viewport (scrollbar over the bar)`).toBeLessThanOrEqual(width);
            expect(bar.nav.bottom, `${where}: bar below the viewport`).toBeLessThanOrEqual(bar.viewportHeight + 0.5);
            // Neighbouring labels never run together: their glyphs keep a gap.
            for (let i = 1; i < bar.tabs.length; i++) {
              const left = Math.max(...bar.tabs[i - 1].textRects.map((r) => r.right));
              const right = Math.min(...bar.tabs[i].textRects.map((r) => r.left));
              expect(
                right - left,
                `${where}: "${bar.tabs[i - 1].label}" and "${bar.tabs[i].label}" run together`,
              ).toBeGreaterThanOrEqual(MIN_LABEL_GAP);
            }
            for (const tab of bar.tabs) {
              const what = `${where} "${tab.label}"`;
              // The label box and every glyph line sit wholly inside the bar.
              for (const r of [tab.labelBox, ...tab.textRects]) {
                expect(r.top, `${what}: label above the bar`).toBeGreaterThanOrEqual(bar.nav.top - 0.5);
                expect(r.bottom, `${what}: label below the bar`).toBeLessThanOrEqual(bar.nav.bottom + 0.5);
              }
              expect(tab.labelBox.left, `${what}: label left of the bar`).toBeGreaterThanOrEqual(bar.nav.left - 0.5);
              expect(tab.labelBox.right, `${what}: label right of the bar`).toBeLessThanOrEqual(bar.nav.right + 0.5);
              expect(tab.box.bottom - tab.box.top, `${what}: tap height`).toBeGreaterThanOrEqual(44);
              // The current-tab marker never sits on the icon or the label.
              if (tab.indicator) {
                const textLines = tab.textRects.map((r) => ({ ...r, left: tab.labelBox.left, right: tab.labelBox.right }));
                for (const other of [tab.icon, ...textLines]) {
                  const overlapX = Math.min(tab.indicator.right, other.right) - Math.max(tab.indicator.left, other.left);
                  const overlapY = Math.min(tab.indicator.bottom, other.bottom) - Math.max(tab.indicator.top, other.top);
                  expect(overlapX > 0.5 && overlapY > 0.5, `${what}: current-tab marker overlaps the icon or label`).toBe(false);
                }
              }
              report.push(
                `${locale}\t@${width}\t${screenId}\t${tab.label}\tlines=${tab.lines}\ttext=${tab.textWidth.toFixed(1)}\tbutton=${tab.box.width.toFixed(1)}`,
              );
              expect(tab.fontSize, `${what}: font size`).toBeGreaterThanOrEqual(12);
              expect(tab.clippedX, `${what}: clipped across`).toBe(false);
              expect(tab.clippedY, `${what}: clipped down (line clamp) ${tab.heights}`).toBe(false);
              expect(tab.lines, `${what}: lines`).toBeLessThanOrEqual(2);
              expect(tab.outside, `${what}: drawn outside its button`).toBe(0);
              expect(tab.box.left, `${what}: off screen`).toBeGreaterThanOrEqual(0);
              expect(tab.box.right, `${what}: off screen`).toBeLessThanOrEqual(width);
              expect(tab.box.top, `${what}: above the bar`).toBeGreaterThanOrEqual(bar.nav.top - 0.5);
              expect(tab.box.bottom, `${what}: below the bar`).toBeLessThanOrEqual(bar.nav.bottom + 0.5);
            }
          } finally {
            await session.close();
          }
        }
      }, 240_000);
    }
  }
});
