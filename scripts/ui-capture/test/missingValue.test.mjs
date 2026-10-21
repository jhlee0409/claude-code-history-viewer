// Raw JSONL → real HTTP → real app. No invented token responses.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { webkit, chromium } from "playwright";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator, SUPPORTED_LOCALES } from "../lib/i18n.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";
/* global document, window, getComputedStyle */
const REPO = process.cwd();
const BIN = path.join(REPO, ".ui-capture/build/cchv-server");
const DIST = process.env.UI_TEST_DIST ?? path.join(REPO, ".ui-capture/build/dist");
const ENABLED = fs.existsSync(BIN) && fs.existsSync(path.join(DIST, "index.html")) && fs.existsSync(webkit.executablePath());
if (!ENABLED && process.env.CI_REQUIRE_BROWSER === "1") throw new Error("Missing-value tests require fresh frontend, server and WebKit");
const root = path.join(REPO, ".ui-capture/missing-value-fixture");
const observations = [];
let fixture, server, target;
const browsers = {};
const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, reasoning_tokens: 0 };
const states = process.env.UI_MISSING_STATE ? [process.env.UI_MISSING_STATE] : ["absent", "recorded", "partial", "positive"];
beforeAll(async () => {
  if (!ENABLED) return;
  fixture = generateFixture({ root });
  target = fixture.projects.find((p) => p.name === "meridian-usage").sessions.find((s) => s.key === "usage-cache");
  // Keep the real session identity and summary. Every selected row's token
  // evidence is explicit, including user rows for the synthetic recorded case.
  target.original = fs.readFileSync(target.filePath, "utf8");
  server = await startServer({ binary: BIN, dist: DIST, home: fixture.home, fixtureRoot: root, logFile: path.join(root, "server.log") });
  browsers.webkit = await webkit.launch();
  if (fs.existsSync(chromium.executablePath())) browsers.chromium = await chromium.launch();
});
afterAll(async () => {
  for (const browser of Object.values(browsers)) await browser.close();
  await server?.stop();
  if (process.env.UI_MISSING_REPORT) fs.writeFileSync(process.env.UI_MISSING_REPORT, JSON.stringify(observations, null, 2));
});

function writeRaw(state) {
  const rows = target.original.trim().split("\n").map(JSON.parse);
  for (const row of rows) {
    row.timestamp = fixture.fixedNow;
    if (row.message) {
      delete row.message.usage;
      if (state === "recorded") row.message.usage = zero;
      if (state === "partial" && row.type === "assistant") row.message.usage = { input_tokens: 0 };
      if (state === "positive" && row.type === "assistant") row.message.usage = { input_tokens: 13, output_tokens: 7 };
      if (state === "absent") delete row.message.model;
    }
  }
  fs.writeFileSync(target.filePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

describe.skipIf(!ENABLED)("truthful recorded absence and numeric zero (real app)", () => {
  for (const engine of ["webkit", "chromium"]) for (const locale of SUPPORTED_LOCALES) for (const width of [1440, 390]) for (const state of states) {
    it(`${engine} ${locale} ${width}px 125% ${state}`, async () => {
      if (!browsers[engine]) {
        if (process.env.CI_REQUIRE_BROWSER === "1" && engine === "webkit") throw new Error("WebKit missing");
        return;
      }
      writeRaw(state);
      const response = await fetch(`${server.origin}/api/get_session_token_stats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionPath: target.filePath, statsMode: "billing" }) });
      expect(response.status).toBe(200);
      const stats = await response.json();
      expect(stats.token_usage_recording).toBe(state === "positive" ? "partial" : state);
      if (state !== "positive") expect(stats.total_tokens).toBe(0);
      else expect(stats.total_tokens).toBeGreaterThan(0);
      const scenario = expandScenarios().find((s) => s.id === `inspector-tokens--${width === 390 ? "390x844" : "1440x900"}--dark`);
      const session = await newScenarioPage(browsers[engine], { scenario, origin: server.origin, locale, fixedNow: fixture.fixedNow,
        storageSeed: { ...STORAGE_SEED, ...(scenario.screen.storage ?? {}) }, variant: { fontScale: 1.25 } });
      let rendered = "";
      const t = loadTranslator(REPO, locale);
      try {
        await session.page.goto(server.origin, { waitUntil: "domcontentloaded" });
        await settle(session);
        const run = createActions({ session, scenario, manifest: fixture, t });
        await run({ do: "openSession", session: "usage-cache" });
        if (width === 390) await run({ do: "view", view: "analyticsTokens" });
        await settle(session);
        const region = width === 390 ? session.page.locator('[data-session-stats-card]').first() : session.page.getByRole("region", { name: t("analytics.totalTokens"), exact: true });
        rendered = await region.innerText();
        // The capture-only baseline is explicitly not an acceptance run.
        if (!process.env.UI_MISSING_CAPTURE_ONLY) {
          if (state === "absent") expect(rendered).toContain(t("common.missingValue.notRecorded"));
          else expect(await region.locator('[data-num]').first().innerText()).toBe(String(stats.total_tokens));
          if (state === "partial" || state === "positive") expect(rendered).toContain(t("common.missingValue.partialTokens"));
          expect(rendered).not.toMatch(/NaN|Invalid Date/);
        }
        const geometry = await session.page.evaluate(() => ({ width: window.innerWidth, pageWidth: document.documentElement.scrollWidth,
          font: getComputedStyle(document.documentElement).fontSize,
          overflow: [...document.querySelectorAll('[data-session-stats-card], [role=tabpanel]')].filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 1).map((el) => ({ text: el.textContent.slice(0, 100), scroll: el.scrollWidth, client: el.clientWidth })) }));
        expect(geometry.font).toBe("20px");
        expect(geometry.pageWidth).toBeLessThanOrEqual(width);
        expect(geometry.overflow).toEqual([]);
        expect(session.log.pageErrors).toEqual([]);
        observations.push({ engine, locale, state, ...geometry, recording: stats.token_usage_recording, total: stats.total_tokens, rendered });
      } finally {
        if (process.env.UI_MISSING_SHOTS) {
          fs.mkdirSync(process.env.UI_MISSING_SHOTS, { recursive: true });
          await session.page.screenshot({ path: path.join(process.env.UI_MISSING_SHOTS, `${engine}-${locale}-${width}-${state}.png`) });
        }
        await session.close();
      }
    }, 60_000);
  }
});
