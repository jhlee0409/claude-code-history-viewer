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
// - No projects: the main area says the same as the sidebar (no projects
//   found) instead of asking to select a session. Before any provider
//   discovery (first launch) both say "no Claude Code projects" and the main
//   area offers "Find other providers".
// - Transcript: the current-date label never sits on top of the message
//   list (it gets its own row).
// - Transcript search: the placeholder fits the input in every locale, at a
//   narrow desktop main pane (navigator open) and on a phone.

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

  for (const locale of ["en", "ko"]) {
    it(`no projects (${locale}): sidebar and main say the same thing, no "select a session"`, async () => {
      const { session, page, t } = await openScenario("empty--1440x900--light", { locale });
      try {
        const main = page.locator("[data-slot=main]");
        await expect(main.getByRole("heading", { name: t("session.noProjects.title"), exact: true }).count()).resolves.toBe(1);
        await expect(main.getByText(t("session.select"), { exact: true }).count()).resolves.toBe(0);
        // Once as the main heading, once as the project tree's empty text.
        const everywhere = await page.getByText(t("session.noProjects.title"), { exact: true }).count();
        expect(everywhere).toBe(2);
      } finally {
        await session.close();
      }
    }, 120_000);
  }

  for (const locale of ["en", "ko"]) {
    it(`no projects before provider discovery (${locale}): "no Claude Code projects", offers Find other providers`, async () => {
      const { session, page, t } = await openScenario("empty-first-launch--1440x900--light", { locale });
      try {
        const main = page.locator("[data-slot=main]");
        await expect(main.getByRole("heading", { name: t("session.noProjects.claudeTitle"), exact: true }).count()).resolves.toBe(1);
        await expect(main.getByRole("heading", { name: t("session.noProjects.title"), exact: true }).count()).resolves.toBe(0);
        await expect(main.getByRole("button", { name: t("project.discoverProviders"), exact: true }).count()).resolves.toBe(1);
        const titles = page.getByText(t("session.noProjects.claudeTitle"), { exact: true });
        expect(await titles.count()).toBe(2);
        // The longer title wraps in the sidebar: Korean wraps between words
        // (keep-all), never inside one ("없\n습니다").
        const wordBreaks = await titles.evaluateAll((els) => els.map((el) => getComputedStyle(el).wordBreak));
        expect(wordBreaks).toEqual(locale === "ko" ? ["keep-all", "keep-all"] : ["normal", "normal"]);
      } finally {
        await session.close();
      }
    }, 120_000);
  }

  const transcriptCases = [
    ...SUPPORTED_LOCALES.map((locale) => ({ id: "transcript--1180x760--light", locale, storage: { "navigator-open": "true" } })),
    ...SUPPORTED_LOCALES.map((locale) => ({ id: "transcript--390x844--dark", locale, storage: {} })),
    { id: "transcript--1440x900--light", locale: "en", storage: {} },
  ];

  for (const { id, locale, storage } of transcriptCases) {
    const label = `${id} ${locale}${storage["navigator-open"] === "true" ? " (navigator open)" : ""}`;
    it(`${label}: search placeholder fits, date label sits outside the message list`, async () => {
      const { session, page, t } = await openScenario(id, { locale, storage });
      try {
        const search = page.getByRole("textbox", { name: t("messageViewer.searchPlaceholder"), exact: true });
        const fit = await search.evaluate((input) => {
          const style = getComputedStyle(input);
          const ctx = document.createElement("canvas").getContext("2d");
          ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const text = ctx.measureText(input.placeholder).width;
          const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return { text, room, placeholder: input.placeholder };
        });
        expect.soft(fit.text, `"${fit.placeholder}" ${fit.text.toFixed(1)}px in ${fit.room.toFixed(1)}px`).toBeLessThanOrEqual(fit.room);

        // The scroll viewport of the message list holds the virtual rows.
        const list = await page.evaluate(() => {
          const row = document.querySelector("[data-index]");
          for (let el = row?.parentElement; el; el = el.parentElement) {
            const overflowY = getComputedStyle(el).overflowY;
            if (overflowY === "auto" || overflowY === "scroll") {
              const r = el.getBoundingClientRect();
              return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            }
          }
          return null;
        });
        expect(list).not.toBeNull();
        // The date label: the visible atomic polite live region (the base
        // build's floating pill has no data hook, hence the role query;
        // sr-only announcers share the role).
        const status = page.locator("[data-current-date], [role=status][aria-live=polite][aria-atomic=true]:not(.sr-only)");
        expect(await status.count()).toBe(1);
        const label = await status.first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height, text: el.textContent };
        });
        expect(label.text).toMatch(/\S/);
        expect(label.height).toBeGreaterThan(0);
        expect.soft(overlapArea(label, list), `date label "${label.text}" overlaps the message list`).toBe(0);
      } finally {
        await session.close();
      }
    }, 120_000);
  }
});
