// The frozen capture clock (lib/browser.mjs, newScenarioPage): every scenario
// page starts paused at exactly fixedNow, however slow the browser answers.
//
// Playwright's clock.install({ time }) starts a *running* fake clock, and
// every open document syncs it to wall time from a real timer at least every
// 100 ms; clock.pauseAt(t) only ever jumps forward. Installing and pausing at
// the same instant while a page was open therefore raced that timer: when a
// sync landed between the two protocol round trips (four vitest workers, a
// busy CI runner), the page clock was already past fixedNow and pauseAt threw
// "clock.pauseAt: Cannot fast-forward to the past" before the test reached
// the app. The slow browser below stretches that gap to 250 ms, so the race
// is lost on every run instead of about once per suite.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { newScenarioPage } from "../lib/browser.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global window -- functions passed to page.evaluate run in the page */

const FIXED_NOW = "2026-06-30T00:00:00.000Z";
const FIXED_MS = Date.parse(FIXED_NOW);
/** Longer than the 100 ms real-time sync of Playwright's running page clock. */
const SLOW_CLOCK_CALL_MS = 250;

// What the document's first script sees, plus a timer due 50 ms later.
const PAGE = `<!doctype html><script>
  window.__first = { now: Date.now(), iso: new Date().toISOString() };
  setTimeout(() => { window.__timerFiredAt = Date.now(); }, 50);
</script>`;

const scenario = { id: "clock--1440x900--light", theme: "light", viewport: { width: 1440, height: 900 }, screen: { id: "clock" } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A browser whose contexts answer every clock call SLOW_CLOCK_CALL_MS late,
 * as a loaded machine sometimes does (`page.clock` is `context.clock`).
 */
function slowClockBrowser(browser) {
  return {
    async newContext(options) {
      const context = await browser.newContext(options);
      const { clock } = context;
      const proto = Object.getPrototypeOf(clock);
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor" || typeof proto[name] !== "function") continue;
        clock[name] = async (...args) => {
          await sleep(SLOW_CLOCK_CALL_MS);
          return proto[name].apply(clock, args);
        };
      }
      return context;
    },
  };
}

async function open(browser) {
  const session = await newScenarioPage(browser, {
    scenario,
    origin: "http://127.0.0.1:9",
    locale: "en",
    fixedNow: FIXED_NOW,
    injections: [],
  });
  await session.page.goto(`data:text/html,${encodeURIComponent(PAGE)}`);
  return session;
}

const pageClock = (page) =>
  page.evaluate(() => ({ now: Date.now(), timerFiredAt: window.__timerFiredAt ?? null }));

const req = browserRequirement({ webkit: true });

describe.skipIf(!req.enabled)("frozen capture clock (real WebKit)", () => {
  let browser;
  beforeAll(async () => {
    browser = await webkit.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("starts paused at exactly fixedNow even when every clock call takes 250 ms", async () => {
    const session = await open(slowClockBrowser(browser));
    try {
      expect(await session.page.evaluate(() => window.__first)).toEqual({ now: FIXED_MS, iso: FIXED_NOW });
      await sleep(300);
      expect(await pageClock(session.page)).toEqual({ now: FIXED_MS, timerFiredAt: null });
    } finally {
      await session.close();
    }
  }, 30_000);

  it("moves time and timers only through clock.runFor", async () => {
    const session = await open(browser);
    try {
      expect(await session.page.evaluate(() => window.__first)).toEqual({ now: FIXED_MS, iso: FIXED_NOW });
      await sleep(300);
      expect(await pageClock(session.page)).toEqual({ now: FIXED_MS, timerFiredAt: null });
      await session.page.clock.runFor(100);
      expect(await pageClock(session.page)).toEqual({ now: FIXED_MS + 100, timerFiredAt: FIXED_MS + 50 });
    } finally {
      await session.close();
    }
  }, 30_000);
});
