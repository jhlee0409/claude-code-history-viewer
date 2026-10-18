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
//   list (it gets its own row), and names the day of the first visible row,
//   not of an overscanned row above the viewport.
// - Analytics heatmap: the day numbers reach 4.5:1 on their cells (colours
//   resolved by WebKit's own canvas), light and dark.
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
import { STORAGE_SEED, expandScenarios, inspectorStorage } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global document, window -- functions passed to page.evaluate run in the page */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");
const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
const HAS_SERVER = fs.existsSync(SERVER_BIN);
// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit/server into an error.
const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "appLayout.test" }).enabled;

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

  it("transcript: the date bar names the day of the first visible row at a day boundary", async () => {
    // The large session crosses midnight in the pinned timezone (Asia/Seoul):
    // one divider ("Today") between the two days, a few pages up.
    const { session, page } = await openScenario("transcript--1440x900--light", { locale: "en" });
    try {
      const viewport = await page.evaluateHandle(() => {
        const row = document.querySelector("[data-index]");
        for (let el = row?.parentElement; el; el = el.parentElement) {
          const overflowY = getComputedStyle(el).overflowY;
          if (overflowY === "auto" || overflowY === "scroll") return el;
        }
        return null;
      });
      // The virtualizer renders a scroll position a frame or more later, so
      // the rows in the DOM right after a scroll can belong to an earlier
      // position (on a Mac about 4 checks in 10 were). Checking those, the
      // scan could step past the divider; on the slower Linux runner it did,
      // and then sat at the fully loaded top until it gave up. Each check
      // waits until the rendered rows cover the viewport: consecutive
      // viewports overlap, so no row can be skipped.
      const rowsCoverViewport = () =>
        viewport.evaluate((vp) => {
          const box = vp.getBoundingClientRect();
          const rows = [...vp.querySelectorAll("[data-index]")].map((row) => row.getBoundingClientRect());
          if (rows.length === 0) return false;
          const top = Math.min(...rows.map((r) => r.top));
          const bottom = Math.max(...rows.map((r) => r.bottom));
          return top <= box.top + 1 && bottom >= Math.min(box.bottom, box.top + vp.scrollHeight - vp.scrollTop) - 1;
        });
      const waitForRows = async () => {
        for (let i = 0; i < 100; i += 1) {
          if (await rowsCoverViewport()) return;
          await page.clock.runFor(50);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("the transcript never rendered rows for its scroll position");
      };
      // Scroll up (loading earlier pages at the top) until a divider with
      // enough rows above it for overscan to render some of the previous day.
      let label = null;
      for (let step = 0; step < 600 && !label; step += 1) {
        await waitForRows();
        const state = await viewport.evaluate((vp) => {
          for (const sep of vp.querySelectorAll("[data-index] [role=separator][aria-label]")) {
            if (Number(sep.closest("[data-index]").dataset.index) >= 20) return { label: sep.getAttribute("aria-label") };
          }
          vp.scrollTop = Math.max(0, vp.scrollTop - vp.clientHeight * 0.9);
          return { top: vp.scrollTop };
        });
        if (state.label) label = state.label;
        else if (state.top === 0) await settle(session, { label: "load earlier" });
        else await page.clock.runFor(50);
      }
      expect(label, "no day divider in the large transcript").not.toBeNull();
      // Put the divider row's top at `rowTop` px from the viewport top. Rows
      // are measured as they render, so re-align until the position holds.
      const barWithDividerAt = async (rowTop) => {
        for (let i = 0; i < 8; i += 1) {
          const delta = await viewport.evaluate((vp, { label, rowTop }) => {
            const sep = [...vp.querySelectorAll("[role=separator]")].find((s) => s.getAttribute("aria-label") === label);
            const top = sep.closest("[data-index]").getBoundingClientRect().top - vp.getBoundingClientRect().top;
            const d = top - rowTop;
            if (Math.abs(d) >= 1) vp.scrollTop += d;
            return d;
          }, { label, rowTop });
          if (Math.abs(delta) < 1) break;
          await settle(session, { label: "align divider" });
        }
        return page.locator("[data-current-date]").innerText();
      };
      // The divider at the top edge: its day (overscan renders the previous
      // day's rows above it, which the bar used to read).
      expect(await barWithDividerAt(-2)).toBe(label);
      // Scrolled into the new day's first message: still that day.
      expect(await barWithDividerAt(-40)).toBe(label);
      // The previous day's last row still showing 20px: the previous day.
      expect(await barWithDividerAt(20)).not.toBe(label);
    } finally {
      await session.close();
    }
  }, 180_000);

  /** WCAG 2 ratio of each heatmap day number on its cell, resolved by WebKit's canvas. */
  const heatmapDayContrasts = (page) =>
    page.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      // Paint the layers bottom-up (card, cell, text) so a translucent
      // colour is measured as it shows, composited over what is below it.
      const paint = (...layers) => {
        ctx.clearRect(0, 0, 1, 1);
        for (const css of layers) {
          ctx.fillStyle = "#000";
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
        }
        return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return Array.from(document.querySelectorAll('button[style*="--heatmap-"] span'))
        .filter((span) => span.textContent === "1")
        .map((span) => {
          const cell = span.closest("button");
          const card = getComputedStyle(document.body).backgroundColor;
          const fill = getComputedStyle(cell).backgroundColor;
          const [a, b] = [lum(paint(card, fill, getComputedStyle(span).color)), lum(paint(card, fill))];
          return {
            cell: cell.style.backgroundColor,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });
    });

  for (const theme of ["light", "dark"]) {
    it(`analytics heatmap (${theme}): day numbers reach 4.5:1 on their cells`, async () => {
      const { session, page } = await openScenario(`analytics--1440x900--${theme}`, { locale: "en" });
      try {
        const results = await heatmapDayContrasts(page);
        expect(results.length).toBeGreaterThan(0);
        for (const { cell, ratio } of results) {
          expect.soft(ratio, `day "1" on ${cell}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      } finally {
        await session.close();
      }
    }, 120_000);
  }

  const transcriptCases = [
    // The narrowest desktop main pane: the inspector open (its outline).
    ...SUPPORTED_LOCALES.map((locale) => ({ id: "transcript--1180x760--light", locale, storage: inspectorStorage({ open: true }) })),
    ...SUPPORTED_LOCALES.map((locale) => ({ id: "transcript--390x844--dark", locale, storage: {} })),
    { id: "transcript--1440x900--light", locale: "en", storage: {} },
  ];

  for (const { id, locale, storage } of transcriptCases) {
    const label = `${id} ${locale}${storage["navigator-open"] === "true" ? " (inspector open)" : ""}`;
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
