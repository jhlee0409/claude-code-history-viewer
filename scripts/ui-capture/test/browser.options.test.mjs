// Context option precedence (plan I0, R8): a variant flag or a scenario's
// variant must beat both the harness defaults and a test's contextOptions.
// Before I0, `newScenarioPage` spread `contextOptions` first and then pinned
// reducedMotion "reduce" / forcedColors "none" / Asia/Seoul after it, so no
// caller could ever capture with motion, forced colours or another zone.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { newScenarioPage } from "../lib/browser.mjs";
import { effectiveVariant, normalizeVariant, resolveContextOptions, variantTag, VariantError } from "../lib/variant.mjs";
import { browserRequirement } from "./requirements.mjs";

/* global window, document -- functions passed to page.evaluate run in the page */

const scenario = { id: "x--1440x900--dark", theme: "dark", viewport: { width: 1440, height: 900 }, screen: { id: "x" } };

describe("resolveContextOptions", () => {
  it("keeps the deterministic defaults without a variant", () => {
    const options = resolveContextOptions({ scenario, locale: "en", variant: {} });
    expect(options).toMatchObject({
      reducedMotion: "reduce",
      forcedColors: "none",
      contrast: "no-preference",
      timezoneId: "Asia/Seoul",
      colorScheme: "dark",
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
  });

  it("lets the variant beat contextOptions for every emulated media feature", () => {
    const options = resolveContextOptions({
      scenario,
      locale: "en",
      contextOptions: { reducedMotion: "reduce", forcedColors: "none", contrast: "no-preference", timezoneId: "UTC", hasTouch: true },
      variant: { motion: "full", forcedColors: "active", contrast: "more", timezone: "Asia/Kolkata" },
    });
    expect(options).toMatchObject({
      reducedMotion: "no-preference",
      forcedColors: "active",
      contrast: "more",
      timezoneId: "Asia/Kolkata",
      hasTouch: true, // a context option no variant controls survives
    });
  });

  it("lets run flags beat the scenario's own variant, key by key", () => {
    const v = effectiveVariant({ motion: "full", timezone: undefined }, { motion: "reduce", timezone: "Asia/Kolkata" });
    expect(v.motion).toBe("full");
    expect(v.timezone).toBe("Asia/Kolkata");
  });

  it("rejects unknown values instead of ignoring them", () => {
    expect(() => normalizeVariant({ motion: "fast" })).toThrow(VariantError);
    expect(() => normalizeVariant({ timezone: "Mars/Olympus" })).toThrow(VariantError);
    expect(() => normalizeVariant({ viewport: "big" })).toThrow(VariantError);
    expect(() => normalizeVariant({ fontScale: "x" })).toThrow(VariantError);
  });

  it("tags only what differs from the default", () => {
    expect(variantTag({})).toBe("");
    expect(variantTag({ fontScale: 1.25, viewport: "1180x800", inspector: "open" })).toBe("font125+vp-1180x800+inspector-open");
  });
});

const req = browserRequirement({ webkit: true });

describe.skipIf(!req.enabled)("variant reaches the page (real WebKit)", () => {
  let browser;
  beforeAll(async () => {
    browser = await webkit.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("contextOptions reducedMotion=reduce + --motion full → prefers-reduced-motion does not match", async () => {
    const session = await newScenarioPage(browser, {
      scenario,
      origin: "http://127.0.0.1:9",
      locale: "en",
      fixedNow: "2026-06-30T00:00:00.000Z",
      injections: [],
      contextOptions: { reducedMotion: "reduce" },
      variant: { motion: "full", timezone: "Asia/Kolkata", contrast: "more" },
    });
    try {
      await session.page.setContent("<p>x</p>");
      const media = await session.page.evaluate(() => ({
        reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        contrastMore: window.matchMedia("(prefers-contrast: more)").matches,
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
      expect(media).toEqual({ reduce: false, contrastMore: true, zone: "Asia/Kolkata" });
    } finally {
      await session.close();
    }
  }, 30_000);

  it("--font-scale 1.25 sets the root font size to 20px", async () => {
    const session = await newScenarioPage(browser, {
      scenario,
      origin: "http://127.0.0.1:9",
      locale: "en",
      fixedNow: "2026-06-30T00:00:00.000Z",
      injections: [],
      variant: { fontScale: 1.25 },
    });
    try {
      await session.page.goto("data:text/html,<p>x</p>");
      expect(await session.page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");
    } finally {
      await session.close();
    }
  }, 30_000);
});
