// Reduced motion in the running app (inner-UI plan F1b, D8, G-MO1).
//
// Real WebKit in the harness's --live mode (real clock, CSS motion not
// suppressed), the real app and fixture. For each interaction - open the
// command palette, open the gear menu, expand a tool row, run a
// conversation search that scrolls to the match - motion is sampled right
// after it (0, 16, 100 ms: running animations and transitions, their start
// events, and how many frames a scroll spreads over):
//   1. prefers-reduced-motion: no-preference -> motion IS observed (otherwise
//      this test proves nothing, so it fails);
//   2. reduce -> nothing moves: no animation or transition at any sample, no
//      start event, and a scroll jumps instead of gliding over consecutive
//      frames (scroll-driven animations such as the scrollbar handle follow
//      the scroll position and are not counted, lib/motion.mjs).
// Before F1b (UI_TEST_DIST=<base dist>) part 2 fails: the app ignored the
// setting. Skipped without WebKit or without a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { measureMotion } from "../lib/motion.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, window, Element */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "motion.reduce.test" }).enabled;

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("motion-reduce");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const INTERACTIONS = [
  {
    name: "open the command palette",
    scenario: "transcript--1440x900--light",
    act: async ({ page, t }) => {
      await page.locator("#app-header").getByRole("button", { name: t("common.commandPalette"), exact: true }).filter({ visible: true }).first().click();
    },
  },
  {
    name: "open the gear menu",
    scenario: "transcript--1440x900--light",
    act: async ({ page }) => {
      await page.locator("#app-settings-button").click();
    },
  },
  {
    name: "expand a tool row",
    scenario: "transcript-mixed-turn--1440x900--light",
    act: async ({ page }) => {
      await page.locator('#main-content [data-message-uuid] button[aria-expanded="false"]').first().click();
    },
  },
];

/**
 * The conversation search scrolls to each match ("next match" = Enter). Some
 * jumps go through the virtual list (instant) and some glide to a match
 * already on the page, so one press is not enough to see a smooth scroll:
 * walk SEARCH_PRESSES matches and keep every measurement.
 *
 * Two signals per run: the scroll the app asks for (`behavior` of every
 * scrollTo / scrollBy / scrollIntoView call, recorded by a wrapper) and how
 * the page moved (consecutive frames with a scroll event). How many frames a
 * smooth scroll spreads over depends on the engine build: macOS WebKit
 * glides over many, while the Linux CI runner's WebKit showed at most 2 for
 * the same jumps. So "the test can see it" rests on the request, which every
 * build reports the same way, and the frame runs are an extra check where
 * the engine glides.
 */
const SEARCH_PRESSES = 8;
async function searchScrolls(motion) {
  const session = await openScenario(browser, app, "transcript--1440x900--light", { variant: { live: true, motion } });
  try {
    await session.page.evaluate(() => {
      const requests = [];
      window.__scrollRequests = requests;
      const wrap = (target, name) => {
        const original = target[name];
        target[name] = function (...args) {
          const options = args[0];
          requests.push(options && typeof options === "object" ? (options.behavior ?? "auto") : "auto");
          return original.apply(this, args);
        };
      };
      for (const name of ["scrollTo", "scrollBy", "scrollIntoView"]) wrap(Element.prototype, name);
      for (const name of ["scrollTo", "scrollBy"]) wrap(window, name);
    });
    const input = session.page.locator("#main-content").getByRole("textbox", { name: session.t("messageViewer.searchPlaceholder") }).first();
    await input.fill("the");
    const runs = [];
    for (let i = 0; i < SEARCH_PRESSES; i += 1) {
      runs.push(await measureMotion(session.page, () => input.press("Enter")));
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const requests = await session.page.evaluate(() => window.__scrollRequests);
    return { runs, requests };
  } finally {
    await session.close();
  }
}

async function sample(interaction, motion) {
  const session = await openScenario(browser, app, interaction.scenario, { variant: { live: true, motion } });
  try {
    // Start from a still page: the screen's own entrance motion has ended.
    await session.page.waitForFunction(() => document.getAnimations().filter((a) => a.playState === "running").length === 0, null, { timeout: 10_000 }).catch(() => {});
    return await measureMotion(session.page, () => interaction.act(session));
  } finally {
    await session.close();
  }
}

describe.skipIf(!ENABLED)("reduced motion in the running app (real WebKit, --live)", () => {
  it.each(INTERACTIONS)("$name: motion is observed without a preference (the test can see it)", async (interaction) => {
    const motion = await sample(interaction, "full");
    expect(motion.animationsAt.some((n) => n > 0) || motion.transitionEvents > 0 || motion.animationEvents > 0, JSON.stringify(motion)).toBe(true);
  }, 120_000);

  it("search: without a preference, a jump to a match asks for a smooth scroll (the test can see it)", async () => {
    const { runs, requests } = await searchScrolls("full");
    const detail = JSON.stringify({ requests, frames: runs.map((m) => [m.scrollFrames, m.scrollRun]) });
    expect(requests.filter((b) => b === "smooth").length, detail).toBeGreaterThan(0);
  }, 180_000);

  it("search: under prefers-reduced-motion: reduce, every jump to a match is instant", async () => {
    const { runs, requests } = await searchScrolls("reduce");
    const detail = JSON.stringify({ requests, frames: runs.map((m) => [m.scrollFrames, m.scrollRun]) });
    // The app asks for scrolls (the jumps happen) but never a smooth one ...
    expect(requests.length, detail).toBeGreaterThan(0);
    expect(requests.filter((b) => b === "smooth"), detail).toEqual([]);
    // ... and the page does not glide (CSS scroll-behavior is off too).
    expect(runs.map((m) => m.scrollRun).filter((run) => run > 2), detail).toEqual([]);
    for (const m of runs) expect(m.animationsAt).toEqual([0, 0, 0]);
  }, 180_000);

  it.each(INTERACTIONS)("$name: nothing moves under prefers-reduced-motion: reduce", async (interaction) => {
    const motion = await sample(interaction, "reduce");
    expect(motion.animationsAt, JSON.stringify(motion)).toEqual([0, 0, 0]);
    expect(motion.transitionEvents, JSON.stringify(motion)).toBe(0);
    expect(motion.animationEvents, JSON.stringify(motion)).toBe(0);
    expect(motion.scrollRun, JSON.stringify(motion)).toBeLessThanOrEqual(2);
  }, 120_000);
});
