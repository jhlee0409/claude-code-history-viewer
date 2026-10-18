// Browser side of a capture: one fresh context per scenario with every
// source of nondeterminism pinned (clock, locale, timezone, DPR, motion,
// theme, storage, network), request tracking, injection and the settle loop.

/* global document, navigator, window -- functions passed to page.evaluate run in the page */

import { fontScaleCss, normalizeVariant, resolveContextOptions } from "./variant.mjs";

/** Virtual time advanced per settle step while the app is network-idle. */
const STEP_MS = 100;
/** Real time to let network, React and layout progress between steps. */
const REAL_POLL_MS = 40;
/** Consecutive quiet steps required to call a screen settled. */
const QUIET_STEPS = 4;
const SETTLE_TIMEOUT_MS = 45_000;

/**
 * Injected at document start: hide carets, count DOM mutations and, in the
 * deterministic capture mode, freeze motion (animation/transition none, no
 * smooth scroll). `--live` (plan I0, R8) leaves motion alone so a test can
 * observe it; `extraCss` carries variant CSS (the --font-scale root size).
 */
export const initScript = ({ live = false, extraCss = "" } = {}) => {
  const rules = [
    "*, *::before, *::after {",
    ...(live ? [] : ["  animation: none !important;", "  transition: none !important;"]),
    "  caret-color: transparent !important;",
    ...(live ? [] : ["  scroll-behavior: auto !important;"]),
    "}",
    ...(extraCss ? [extraCss] : []),
  ];
  return `(() => {
  const css = ${JSON.stringify(rules.join("\n"))};
  const state = { mutations: 0 };
  Object.defineProperty(window, "__uiCapture", { value: state });
  const install = () => {
    if (document.querySelector("style[data-ui-capture]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-ui-capture", "");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) install();
  document.addEventListener("DOMContentLoaded", install);
  new MutationObserver((records) => {
    state.mutations += records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})();`;
};

/**
 * Seeds localStorage before any app script runs (the context starts empty).
 * Re-applied on every document of the context; captures never reload.
 */
const storageSeedScript = (seed) => `(() => {
  const seed = ${JSON.stringify(seed)};
  for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, value);
})();`;

/**
 * `contextOptions` adds Playwright context options to the scenario's (tests
 * only: `hasTouch` makes the page a touch screen, `(pointer: coarse)`).
 * `variant` (lib/variant.mjs) picks motion, forced colours, contrast, time
 * zone, font scale and live mode; it wins over `contextOptions` and the
 * defaults (see resolveContextOptions).
 */
export async function newScenarioPage(
  browser,
  { scenario, origin, locale, fixedNow, injections, storageSeed = {}, contextOptions = {}, variant = {} },
) {
  const v = normalizeVariant(variant);
  const context = await browser.newContext(resolveContextOptions({ scenario, locale, contextOptions, variant: v }));
  await context.addInitScript(initScript({ live: v.live, extraCss: fontScaleCss(v.fontScale) }));
  await context.addInitScript(storageSeedScript(storageSeed));
  // Steps act on a settled page, so a locator that does not resolve quickly
  // never will; fail the scenario fast instead of after Playwright's 30 s.
  context.setDefaultTimeout(15_000);

  const log = { blockedRequests: [], consoleErrors: [], pageErrors: [], injected: [] };
  const inflight = new Set();
  const held = new Set();
  const heldRoutes = [];

  // Anything that is not the local server is blocked (Google Fonts, update
  // checks); recorded so a run shows what it would have fetched.
  await context.route(
    (url) => url.origin !== origin,
    (route) => {
      log.blockedRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    },
  );

  for (const rule of injections ?? []) {
    await context.route(`${origin}/api/${rule.command}`, async (route) => {
      log.injected.push(rule.command);
      if (rule.hold) {
        held.add(route.request());
        heldRoutes.push(route);
        return; // never answered; aborted when the context closes
      }
      if (rule.fail) {
        return route.fulfill({
          status: rule.fail.status,
          contentType: "application/json",
          body: JSON.stringify({ error: rule.fail.error }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rule.respond) });
    });
  }

  const page = await context.newPage();
  const tracked = (request) => {
    const url = new URL(request.url());
    // The SSE stream stays open for the page's lifetime by design.
    return url.origin === origin && url.pathname !== "/api/events";
  };
  page.on("request", (request) => {
    if (tracked(request)) inflight.add(request);
  });
  const done = (request) => inflight.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  page.on("console", (message) => {
    if (message.type() === "error") log.consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => log.pageErrors.push(String(error).slice(0, 300)));

  // Frozen wall clock: Date/performance/timers are faked and paused at
  // fixedNow; timers only run when settle() advances virtual time. Live mode
  // runs on the real clock (motion needs real frames).
  if (!v.live) {
    await page.clock.install({ time: new Date(fixedNow) });
    await page.clock.pauseAt(new Date(fixedNow));
  }

  const pendingCount = () => [...inflight].filter((request) => !held.has(request)).length;

  return {
    context,
    page,
    log,
    live: v.live,
    pendingCount,
    heldCount: () => held.size,
    expectedHolds: (injections ?? []).filter((rule) => rule.hold).length,
    async close() {
      await context.close();
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The ⌘/Ctrl key the app under test reads, for a user agent: Meta when it says
 * Mac, Control otherwise (the rule of src/utils/platform.ts isActionModifier).
 * Playwright's "ControlOrMeta" follows the host OS instead, and its WebKit
 * reports a Macintosh user agent on every host, so on Linux it sends Control
 * to an app that waits for Meta.
 */
export const actionModifierFor = (userAgent) => (/mac/i.test(userAgent) ? "Meta" : "Control");

/** actionModifierFor the page's own navigator.userAgent. */
export async function actionModifier(page) {
  return actionModifierFor(await page.evaluate(() => navigator.userAgent));
}

/** Park the pointer where nothing reacts to hover (header padding). */
export async function parkPointer(page) {
  await page.mouse.move(1, 1);
}

/**
 * Wait until the screen is settled: no tracked request in flight (held ones
 * excluded), `data-ready="true"` when the build has the marker (skipped for
 * the loading state), fonts loaded, and no DOM mutation for QUIET_STEPS
 * consecutive steps. Virtual time advances only while the app is network-idle,
 * so timer-driven work (debounces, deferred effects) runs in a fixed order.
 */
export async function settle(session, { mode = "ready", label = "" } = {}) {
  const { page } = session;
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let quiet = 0;
  let steps = 0;
  let lastMutations = -1;
  let lastState = null;
  while (Date.now() < deadline) {
    await sleep(REAL_POLL_MS);
    if (session.pendingCount() > 0) {
      quiet = 0;
      continue;
    }
    if (mode === "loading" && session.heldCount() < session.expectedHolds) {
      quiet = 0;
      continue;
    }
    if (session.live) await sleep(STEP_MS);
    else await page.clock.runFor(STEP_MS);
    steps += 1;
    const state = await page.evaluate(() => {
      const marker = document.querySelector("[data-ready]");
      return {
        mutations: window.__uiCapture?.mutations ?? 0,
        ready: marker ? marker.getAttribute("data-ready") : null,
        fonts: document.fonts.status,
      };
    });
    lastState = state;
    const readyOk = mode === "loading" || state.ready === null || state.ready === "true";
    const stable = state.mutations === lastMutations;
    lastMutations = state.mutations;
    if (stable && readyOk && state.fonts === "loaded" && session.pendingCount() === 0) {
      quiet += 1;
      if (quiet >= QUIET_STEPS) return { virtualMs: steps * STEP_MS, readyMarker: state.ready !== null };
    } else {
      quiet = 0;
    }
  }
  throw new Error(
    `settle timeout${label ? ` (${label})` : ""}: pending=${session.pendingCount()} held=${session.heldCount()} last=${JSON.stringify(lastState)}`,
  );
}

export async function screenshot(page, file) {
  await parkPointer(page);
  // settle() already required document.fonts.status === "loaded"; awaiting
  // document.fonts.ready as well makes the font gate explicit. Node-side
  // timeout, because page timers are frozen.
  const fonts = await Promise.race([
    page.evaluate(() => document.fonts.ready.then(() => document.fonts.status)),
    sleep(10_000).then(() => "timeout"),
  ]);
  if (fonts !== "loaded") throw new Error(`document.fonts.ready did not resolve to "loaded" (${fonts})`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide", scale: "device", fullPage: false });
}
