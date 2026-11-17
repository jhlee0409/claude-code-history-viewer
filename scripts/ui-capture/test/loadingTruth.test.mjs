// Initial project scans are unknown, not empty. Real WebKit, 5 locales,
// phone drawer + desktop, at 125%; the settled empty states are positive controls.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { loadTranslator, SUPPORTED_LOCALES } from "../lib/i18n.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";

/* global document, window, getComputedStyle */
const REPO = process.cwd();
const BIN = path.join(REPO, ".ui-capture/build/cchv-server");
const DIST = process.env.UI_TEST_DIST ?? path.join(REPO, ".ui-capture/build/dist");
const ENABLED = fs.existsSync(webkit.executablePath()) && fs.existsSync(BIN) && fs.existsSync(path.join(DIST, "index.html"));
if (!ENABLED && process.env.CI_REQUIRE_BROWSER === "1") throw new Error("Loading truth requires a fresh frontend, server and WebKit");
const cases = expandScenarios();
const root = path.join(REPO, ".ui-capture", `loading-truth-${process.pid}`);
let fixture, server, browser;
const observations = [];
beforeAll(async () => {
  if (!ENABLED) return;
  fixture = generateFixture({ root });
  server = await startServer({ binary: BIN, dist: DIST, home: fixture.home, fixtureRoot: root, logFile: path.join(root, "server.log") });
  browser = await webkit.launch();
});
afterAll(async () => {
  await browser?.close();
  await server?.stop();
  if (process.env.UI_LOADING_REPORT) fs.writeFileSync(process.env.UI_LOADING_REPORT, JSON.stringify(observations, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!ENABLED)("initial loading and settled-empty truth (WebKit)", () => {
  for (const locale of SUPPORTED_LOCALES) for (const width of [1440, 390]) for (const state of ["loading", "empty", "empty-first-launch", "error", "unscanned-error"]) {
    it(`${locale} ${width}px 125% ${state}`, async () => {
      const screen = state === "unscanned-error" ? "empty-first-launch" : state;
      const scenario = cases.find((s) => s.id === `${screen}--${width === 390 ? "390x844" : "1440x900"}--dark`);
      const injections = state === "unscanned-error" ? [
        { command: "load_user_metadata", respond: { version: 1, sessions: {}, projects: {}, settings: {} } },
        { command: "get_claude_folder_path", fail: { status: 500, error: "CLAUDE_FOLDER_NOT_FOUND:Fixture folder unavailable" } },
      ] : scenario.screen.inject;
      const session = await newScenarioPage(browser, { scenario, origin: server.origin, locale, fixedNow: fixture.fixedNow,
        injections, storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}) }, variant: { fontScale: 1.25 } });
      try {
        const { page } = session;
        const t = loadTranslator(REPO, locale);
        await page.goto(server.origin, { waitUntil: "domcontentloaded" });
        await settle(session, { mode: state === "loading" ? "loading" : "ready" });
        const forbidden = ["session.select", "session.selectDescription", "session.noProjects.title", "session.noProjects.claudeTitle", "project.notFound"];
        if (state === "unscanned-error") {
          for (const key of forbidden) expect(await page.getByText(t(key), { exact: true }).count(), key).toBe(0);
          // LoadingState's error title is a paragraph inside its alert, not a heading.
          // The existing folder picker remains the actionable failure screen.
          expect(await page.getByRole("alert").filter({ hasText: t("common.errorOccurred") }).count()).toBe(1);
          expect(await page.getByRole("heading", { name: t("folderPicker.notFound"), exact: true }).count()).toBe(1);
          expect(await page.getByRole("button", { name: t("folderPicker.selectButton"), exact: true }).count()).toBe(1);
          expect(await page.locator('[aria-busy="true"] .animate-shimmer').count()).toBe(0);
          const footer = page.locator("footer");
          expect(await footer.getByText(t("project.count").replace("{{count}}", "0"), { exact: true }).count()).toBe(0);
          expect(await footer.getByText(t("session.count").replace("{{count}}", "0"), { exact: true }).count()).toBe(0);
          if (process.env.UI_LOADING_SHOTS) {
            fs.mkdirSync(process.env.UI_LOADING_SHOTS, { recursive: true });
            await page.screenshot({ path: path.join(process.env.UI_LOADING_SHOTS, `${locale}-${width}-${state}.png`) });
          }
          observations.push({ locale, width, state, unestablishedCountsHidden: true });
          return;
        }
        if (state === "error") {
          expect(await page.getByRole("heading", { name: t("common.errorOccurred"), exact: true }).count()).toBe(1);
          expect(await page.getByRole("button", { name: t("common.retry"), exact: true }).count()).toBe(1);
          for (const key of forbidden) expect(await page.getByText(t(key), { exact: true }).count(), key).toBe(0);
          expect(await page.locator('.animate-shimmer').count()).toBe(0);
          observations.push({ locale, width, state, errorDistinctFromEmpty: true });
          return;
        }
        if (state === "loading") {
          const footer = page.locator("footer");
          expect(await footer.getByText(t("project.count").replace("{{count}}", "0"), { exact: true }).count()).toBe(0);
          expect(await footer.getByText(t("session.count").replace("{{count}}", "0"), { exact: true }).count()).toBe(0);
          for (const key of forbidden) expect(await page.getByText(t(key), { exact: true }).count(), key).toBe(0);
          expect(await page.locator('[aria-busy="true"] .animate-shimmer').count()).toBeGreaterThan(0);
        }
        if (width === 390) {
          await page.getByRole("button", { name: t("common.mobile.tab.projects"), exact: true }).click();
          await settle(session, { mode: state === "loading" ? "loading" : "ready" });
        }
        const region = page.getByRole("region", { name: t("project.projects"), exact: true });
        expect(await region.count()).toBe(1);
        if (state === "loading") {
          expect(await region.getAttribute("aria-busy")).toBe("true");
          expect(await region.getByText("0", { exact: true }).count()).toBe(0);
          for (const key of forbidden) expect(await region.getByText(t(key), { exact: true }).count(), key).toBe(0);
        } else {
          expect(await region.getByText("0", { exact: true }).count()).toBe(1);
          expect(await region.getByText(t(state === "empty-first-launch" ? "session.noProjects.claudeTitle" : "session.noProjects.title"), { exact: true }).count()).toBe(1);
          expect(await region.getAttribute("aria-busy")).not.toBe("true");
        }
        const geometry = await page.evaluate(() => ({ width: window.innerWidth,
          pageWidth: document.documentElement.scrollWidth, font: getComputedStyle(document.documentElement).fontSize,
          skeletons: [...document.querySelectorAll('.animate-shimmer')].filter((el) => el.getBoundingClientRect().width > 0).length }));
        expect(geometry.width).toBe(width);
        expect(geometry.font).toBe("20px");
        expect(geometry.pageWidth).toBeLessThanOrEqual(width);
        expect(session.log.pageErrors).toEqual([]);
        const shot = process.env.UI_LOADING_SHOTS ? path.join(process.env.UI_LOADING_SHOTS, `${locale}-${width}-${state}.png`) : null;
        if (shot) { fs.mkdirSync(path.dirname(shot), { recursive: true }); await page.screenshot({ path: shot }); }
        observations.push({ locale, state, ...geometry, shot });
      } finally { await session.close(); }
    });
  }
});
