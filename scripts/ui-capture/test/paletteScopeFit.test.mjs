// Tab-to-scope in the ⌘K palette fits (plan T10, owner decision), in every
// locale, measured in real WebKit:
//
// - Phones (390, 360): each Projects row carries the "Search in this
//   project" button (the phone's Tab) inside the row and the dialog, a
//   touch target of at least 24 px, with room left for the project name.
//   Tapping it scopes without opening the project, and the pill that
//   replaces the scope chip stays inside the dialog with its words whole -
//   with a very long project name too, where only the name shortens.
// - Desktop (1440, and 640 - the narrowest width that shows the keyboard
//   hints): the footer's hints, "Tab" included, stay on one line inside the
//   footer; the row button is not shown; Tab scopes and the pill fits.
// - The scoped project's session list fails: the Sessions group shows a
//   failure row (inside the dialog, every locale on the narrowest phone)
//   and "Try again", which asks again and lists the sessions.
//
// Real WebKit, the real app and the harness scenario's own steps, like
// `paletteFit.test.mjs`. Skipped without WebKit or a built server.

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
    `[ui-capture] skipping paletteScopeFit.test: ${HAS_WEBKIT ? `no server at ${SERVER_BIN}` : `no WebKit at ${webkit.executablePath()}`}`,
  );
}

const SCENARIOS = new Map(expandScenarios().map((s) => [s.id, s]));
const PHONE = SCENARIOS.get("palette-scope-pin-target--390x844--dark");
const DESKTOP = SCENARIOS.get("palette-scope-pin-target--1440x900--dark");
const PROJECT = "nimbus-infra";
// Longer than the widest palette (672 px) can show on one line.
const LONG_NAME = "a-very-long-project-name-that-cannot-fit-in-the-palette-".repeat(3);

let dist;
let fixtureRoot;
let fixture;
let server;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  dist = buildDist("cchv-palette-scope-fit-");
  // Inside the checkout: the app hides projects under the system temp dir.
  fixtureRoot = path.join(REPO, ".ui-capture", `palette-scope-fit-fixture-${process.pid}`);
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

async function openPalette({ scenario, locale, width, contextOptions = {} }) {
  const session = await newScenarioPage(browser, {
    contextOptions,
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
  await settle(session, { label: "palette initial" });
  const t = loadTranslator(REPO, locale);
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps) await run(step);
  await settle(session, { label: "palette ready" });
  return { session, t };
}

const pillName = (t, project) => t("globalSearch.scope.pinnedAria").replace("{{project}}", project);

/** The project row, its scope button and the dialog, as rects. */
const measureRow = (page, project) =>
  page.evaluate((name) => {
    const dialog = document.querySelector("[role=dialog]");
    const row = Array.from(dialog.querySelectorAll("[cmdk-item]")).find((el) => el.textContent.includes(name));
    const button = row.querySelector("button");
    const label = row.querySelector("span.truncate");
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { dialog: rect(dialog), row: rect(row), button: rect(button), label: rect(label), viewport: window.innerWidth };
  }, project);

/**
 * The pill: its rect, the dialog's, and whether the words around the name
 * show whole. `longName`: put a long project name in first (the name's own
 * span), as a project with a long folder name would render.
 */
const measurePill = (page, ariaName, longName) =>
  page.evaluate(
    ({ ariaName, longName }) => {
      const dialog = document.querySelector("[role=dialog]");
      const pill = Array.from(dialog.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === ariaName);
      const name = pill.querySelector("span.truncate");
      if (longName) name.textContent = longName;
      const words = Array.from(pill.querySelectorAll("span.whitespace-pre"));
      const icon = pill.querySelector("svg");
      const r = (el) => el.getBoundingClientRect();
      return {
        dialog: { left: r(dialog).left, right: r(dialog).right },
        pill: { left: r(pill).left, right: r(pill).right, height: r(pill).height },
        icon: { right: r(icon).right, width: r(icon).width },
        wordsClipped: words.filter((w) => w.scrollWidth > w.clientWidth + 0.5).map((w) => w.textContent),
        nameWidth: r(name).width,
        nameTruncated: name.scrollWidth > name.clientWidth,
      };
    },
    { ariaName, longName },
  );

function expectPillFits(m, { truncated }) {
  expect(m.pill.left).toBeGreaterThanOrEqual(m.dialog.left);
  expect(m.pill.right).toBeLessThanOrEqual(m.dialog.right);
  expect(m.icon.width).toBeGreaterThan(0);
  expect(m.icon.right).toBeLessThanOrEqual(m.pill.right);
  expect(m.wordsClipped).toEqual([]);
  expect(m.nameWidth).toBeGreaterThan(24);
  expect(m.nameTruncated).toBe(truncated);
}

describe.skipIf(!ENABLED)("⌘K palette Tab-to-scope on a phone", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of [390, 360]) {
      it(`${locale} @${width}: the row button fits and scopes; the pill fits, a long name too`, async () => {
        const { session, t } = await openPalette({ scenario: PHONE, locale, width, contextOptions: { hasTouch: true } });
        const { page } = session;
        try {
          const row = await measureRow(page, PROJECT);
          expect(row.dialog.right).toBeLessThanOrEqual(row.viewport);
          expect(row.button.width).toBeGreaterThanOrEqual(24);
          expect(row.button.height).toBeGreaterThanOrEqual(24);
          expect(row.button.left).toBeGreaterThanOrEqual(row.row.left);
          expect(row.button.right).toBeLessThanOrEqual(row.row.right + 0.5);
          expect(row.row.right).toBeLessThanOrEqual(row.dialog.right + 0.5);
          // The name keeps room to read.
          expect(row.label.width).toBeGreaterThan(60);

          const dialog = page.getByRole("dialog");
          await dialog
            .locator("[cmdk-item]")
            .filter({ hasText: PROJECT })
            .getByRole("button", { name: t("globalSearch.scope.pinAction"), exact: true })
            .tap();
          await dialog.getByRole("button", { name: pillName(t, PROJECT), exact: true }).waitFor();
          // Still the palette: the row was not opened.
          expect(await dialog.count()).toBe(1);
          expectPillFits(await measurePill(page, pillName(t, PROJECT)), { truncated: false });
          expectPillFits(await measurePill(page, pillName(t, PROJECT), LONG_NAME), { truncated: true });
        } finally {
          await session.close();
        }
      }, 120_000);
    }
  }
});

// The scoped project's session list fails (a 500 from the server): the
// Sessions group says so inside the dialog, the scope's live region reports
// it, and "Try again" asks again - its answer lists the project's sessions.
// The review's repro: before the fix the group simply had no rows.
describe.skipIf(!ENABLED)("⌘K palette Tab-to-scope: the project's session list fails", () => {
  const cases = [
    { scenario: () => DESKTOP, locale: "en", width: 1440 },
    ...SUPPORTED_LOCALES.map((locale) => ({ scenario: () => PHONE, locale, width: 360, touch: true })),
  ];
  for (const { scenario, locale, width, touch } of cases) {
    it(`${locale} @${width}: a failure row and "Try again" in Sessions; retry lists the sessions`, async () => {
      const { session, t } = await openPalette({
        scenario: scenario(),
        locale,
        width,
        contextOptions: touch ? { hasTouch: true } : {},
      });
      const { page } = session;
      try {
        let failing = true;
        let asked = 0;
        await page.route(`${server.origin}/api/load_project_sessions`, (route) => {
          const body = route.request().postDataJSON() ?? {};
          if (!String(body.projectPath ?? "").includes(PROJECT)) return route.fallback();
          asked += 1;
          if (!failing) return route.fallback();
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "review list unavailable" }),
          });
        });

        const dialog = page.getByRole("dialog");
        const field = dialog.locator("input[role=combobox]");
        if (touch) {
          await dialog
            .locator("[cmdk-item]")
            .filter({ hasText: PROJECT })
            .getByRole("button", { name: t("globalSearch.scope.pinAction"), exact: true })
            .tap();
        } else {
          await field.press("Tab");
        }
        await dialog.getByRole("button", { name: pillName(t, PROJECT), exact: true }).waitFor();
        await field.fill("state");

        const failedText = t("globalSearch.sessions.failed").replace("{{project}}", PROJECT);
        const sessions = dialog
          .locator("[cmdk-group]")
          .filter({ has: page.locator("[cmdk-group-heading]", { hasText: t("globalSearch.group.sessions") }) });
        const failure = sessions.getByText(failedText, { exact: true });
        await failure.waitFor();
        const retry = sessions.getByRole("option", { name: t("globalSearch.messages.retry"), exact: true });
        expect(await retry.isVisible()).toBe(true);
        expect(await dialog.locator("[data-palette-scope-live]").textContent()).toBe(failedText);
        expect(asked).toBe(1);

        // Inside the dialog, its words whole (it wraps rather than clips).
        const fit = await failure.evaluate((el) => {
          const dialogRect = el.closest("[role=dialog]").getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, dialogLeft: dialogRect.left, dialogRight: dialogRect.right, clipped: el.scrollWidth > el.clientWidth + 0.5 };
        });
        expect(fit.left).toBeGreaterThanOrEqual(fit.dialogLeft);
        expect(fit.right).toBeLessThanOrEqual(fit.dialogRight + 0.5);
        expect(fit.clipped).toBe(false);

        failing = false;
        if (touch) await retry.tap();
        else await retry.click();
        await sessions.getByRole("option", { name: /Split the Terraform state per environment/ }).waitFor();
        expect(asked).toBe(2);
        expect(await failure.count()).toBe(0);
        expect(await retry.count()).toBe(0);
        expect(await dialog.locator("[data-palette-scope-live]").textContent()).not.toBe(failedText);
      } finally {
        await session.close();
      }
    }, 120_000);
  }
});

describe.skipIf(!ENABLED)("⌘K palette Tab-to-scope on a desktop", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of [1440, 640]) {
      it(`${locale} @${width}: the footer's hints (Tab included) fit one line; Tab scopes; the pill fits`, async () => {
        // 640: the app's phone shell (the desktop sidebar steps do not
        // apply), but the palette's keyboard hints show from 640 px on.
        const { session, t } = await openPalette({ scenario: width < 768 ? PHONE : DESKTOP, locale, width });
        const { page } = session;
        try {
          const footer = await page.evaluate((tabHint) => {
            const dialog = document.querySelector("[role=dialog]");
            const hint = Array.from(dialog.querySelectorAll("span")).find((s) => s.textContent === tabHint);
            const hints = hint.parentElement.parentElement;
            const bar = hints.parentElement;
            const r = (el) => el.getBoundingClientRect();
            const style = getComputedStyle(bar);
            const contentRight = r(bar).right - parseFloat(style.paddingRight);
            const items = Array.from(hints.children).map((el) => ({ text: el.textContent, top: r(el).top, bottom: r(el).bottom, right: r(el).right }));
            const count = bar.children[1];
            return {
              contentRight,
              hintsRight: r(hints).right,
              items,
              countLeft: count ? r(count).left : null,
              hintsOverflow: hints.scrollWidth > hints.clientWidth + 0.5,
            };
          }, t("globalSearch.scope.tabHint"));
          expect(footer.hintsOverflow).toBe(false);
          expect(footer.hintsRight).toBeLessThanOrEqual(footer.contentRight + 0.5);
          if (footer.countLeft !== null) expect(footer.hintsRight).toBeLessThanOrEqual(footer.countLeft);
          // One line: every hint overlaps the first vertically.
          for (const item of footer.items) {
            expect(item.top, `${item.text} wrapped`).toBeLessThan(footer.items[0].bottom);
            expect(item.right, `${item.text} past the footer`).toBeLessThanOrEqual(footer.contentRight + 0.5);
          }

          const row = await measureRow(page, PROJECT);
          expect(row.button.width).toBe(0);

          await page.getByRole("dialog").locator("input[role=combobox]").press("Tab");
          await page.getByRole("dialog").getByRole("button", { name: pillName(t, PROJECT), exact: true }).waitFor();
          expectPillFits(await measurePill(page, pillName(t, PROJECT)), { truncated: false });
          expectPillFits(await measurePill(page, pillName(t, PROJECT), LONG_NAME), { truncated: true });
        } finally {
          await session.close();
        }
      }, 120_000);
    }
  }
});
