// Live interaction mode (plan I0, R8): `--live` must let real motion happen,
// or every later "reduced motion" test passes no matter what the app does.
// The deterministic capture injects `animation/transition: none` and freezes
// the clock; live mode drops both (caret hiding and mutation counting stay).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { newScenarioPage } from "../lib/browser.mjs";
import { measureMotion } from "../lib/motion.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global document, window -- functions passed to page.evaluate run in the page */

const PAGE = `<!doctype html><html><head><style>
  #box { width: 80px; height: 40px; background: #888; transition: transform 400ms linear; }
  #box.moved { transform: translateX(120px); }
  #pane { height: 120px; overflow: auto; scroll-behavior: smooth; }
  #pane div { height: 2000px; }
</style></head><body><div id="box"></div><div id="pane"><div>long</div></div></body></html>`;

const scenario = { id: "live--1440x900--light", theme: "light", viewport: { width: 1440, height: 900 }, screen: { id: "live" } };
const req = browserRequirement({ webkit: true });

async function open(browser, variant) {
  const session = await newScenarioPage(browser, {
    scenario,
    origin: "http://127.0.0.1:9",
    locale: "en",
    fixedNow: "2026-06-30T00:00:00.000Z",
    injections: [],
    variant,
  });
  await session.page.goto(`data:text/html,${encodeURIComponent(PAGE)}`);
  return session;
}

const moveBox = (page) => page.evaluate(() => document.getElementById("box").classList.add("moved"));
const smoothScroll = (page) => page.evaluate(() => document.getElementById("pane").scrollTo({ top: 1500 }));

describe.skipIf(!req.enabled)("--live interaction mode (real WebKit)", () => {
  let browser;
  beforeAll(async () => {
    browser = await webkit.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("observes a known CSS transition in --live (otherwise motion tests are meaningless)", async () => {
    const session = await open(browser, { live: true, motion: "full" });
    try {
      const motion = await measureMotion(session.page, () => moveBox(session.page));
      expect(motion.animationsAt.some((n) => n > 0)).toBe(true);
      expect(motion.transitionEvents).toBeGreaterThan(0);
      expect(motion.observed).toBe(true);
    } finally {
      await session.close();
    }
  }, 30_000);

  it("observes a smooth scroll spread over several frames in --live", async () => {
    const session = await open(browser, { live: true, motion: "full" });
    try {
      const motion = await measureMotion(session.page, () => smoothScroll(session.page));
      expect(motion.scrollFrames).toBeGreaterThan(1);
    } finally {
      await session.close();
    }
  }, 30_000);

  it("runs on the real clock in --live", async () => {
    const session = await open(browser, { live: true });
    try {
      const a = await session.page.evaluate(() => Date.now());
      await new Promise((resolve) => setTimeout(resolve, 120));
      const b = await session.page.evaluate(() => Date.now());
      expect(b - a).toBeGreaterThanOrEqual(100);
    } finally {
      await session.close();
    }
  }, 30_000);

  it("suppresses the same transition in the deterministic capture mode (why --live exists)", async () => {
    const session = await open(browser, {});
    try {
      const motion = await measureMotion(session.page, () => moveBox(session.page), { realClock: false });
      expect(motion.animationsAt.every((n) => n === 0)).toBe(true);
      expect(motion.observed).toBe(false);
    } finally {
      await session.close();
    }
  }, 30_000);
});
