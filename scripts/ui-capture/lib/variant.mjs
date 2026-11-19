// Capture variants (plan I0): media and environment emulation chosen on the
// command line (`--forced-colors`, `--contrast`, `--motion`, `--font-scale`,
// `--timezone`, `--viewport`, `--inspector`, `--live`) or by a scenario.
//
// Precedence for every browser context option, lowest first:
//   1. harness defaults (deterministic capture: reduced motion, no forced
//      colours, Asia/Seoul, ...)
//   2. `contextOptions` (tests: e.g. `hasTouch`)
//   3. the scenario's own `variant`
//   4. the run's variant (command-line flags)
// so a flag or a scenario that picks `reducedMotion` / `forcedColors` /
// `contrast` / `timezoneId` always wins (before I0 the defaults were spread
// after `contextOptions` and silently overrode them).

import { BROWSER_LOCALE } from "./i18n.mjs";

export const DEFAULT_VARIANT = Object.freeze({
  motion: "reduce",
  forcedColors: "none",
  contrast: "no-preference",
  fontScale: 1,
  timezone: "Asia/Seoul",
  viewport: null,
  inspector: null,
  live: false,
});

const MOTION = { reduce: "reduce", full: "no-preference" };
const FORCED = ["none", "active"];
const CONTRAST = ["no-preference", "more"];
const INSPECTOR = ["open", "closed"];

export class VariantError extends Error {}

/** `"1180x800"` → `{ id, width, height }`. */
export function parseViewport(text) {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(String(text));
  if (!match) throw new VariantError(`--viewport must look like 1180x800 (got ${text})`);
  return { id: text, width: Number(match[1]), height: Number(match[2]) };
}

/** Validated variant from partial input (flags or a scenario's `variant`). */
export function normalizeVariant(input = {}) {
  const variant = { ...DEFAULT_VARIANT, ...input };
  if (!(variant.motion in MOTION)) throw new VariantError(`--motion must be reduce | full (got ${variant.motion})`);
  if (!FORCED.includes(variant.forcedColors)) throw new VariantError(`--forced-colors must be ${FORCED.join(" | ")}`);
  if (!CONTRAST.includes(variant.contrast)) throw new VariantError(`--contrast must be ${CONTRAST.join(" | ")}`);
  const scale = Number(variant.fontScale);
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 3) throw new VariantError(`--font-scale must be a factor between 0.5 and 3 (got ${variant.fontScale})`);
  variant.fontScale = scale;
  if (typeof variant.timezone !== "string" || !isTimeZone(variant.timezone)) throw new VariantError(`--timezone ${variant.timezone} is not an IANA time zone`);
  if (variant.viewport !== null && typeof variant.viewport === "string") variant.viewport = parseViewport(variant.viewport);
  if (variant.inspector !== null && !INSPECTOR.includes(variant.inspector)) throw new VariantError(`--inspector must be ${INSPECTOR.join(" | ")}`);
  variant.live = Boolean(variant.live);
  return variant;
}

function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Run variant with the scenario's own `variant` laid over it... and the run's flags on top. */
export function effectiveVariant(runVariant, scenarioVariant) {
  return normalizeVariant({ ...(scenarioVariant ?? {}), ...pickSet(runVariant) });
}

/** Only the keys a caller actually set (flags not given stay undefined). */
function pickSet(partial = {}) {
  return Object.fromEntries(Object.entries(partial).filter(([, value]) => value !== undefined));
}

/** Short tag for run dirs, manifests and the base cache key ("" = default). */
export function variantTag(variant) {
  const v = normalizeVariant(variant);
  const parts = [];
  if (v.motion !== DEFAULT_VARIANT.motion) parts.push(`motion-${v.motion}`);
  if (v.forcedColors !== DEFAULT_VARIANT.forcedColors) parts.push(`forced-${v.forcedColors}`);
  if (v.contrast !== DEFAULT_VARIANT.contrast) parts.push(`contrast-${v.contrast}`);
  if (v.fontScale !== DEFAULT_VARIANT.fontScale) parts.push(`font${Math.round(v.fontScale * 100)}`);
  if (v.timezone !== DEFAULT_VARIANT.timezone) parts.push(`tz-${v.timezone.replaceAll("/", "_")}`);
  if (v.viewport) parts.push(`vp-${v.viewport.id}`);
  if (v.inspector) parts.push(`inspector-${v.inspector}`);
  if (v.live) parts.push("live");
  return parts.join("+");
}

/**
 * Playwright `browser.newContext` options for one scenario. Pure: the
 * precedence above is unit-tested in test/browser.options.test.mjs.
 */
export function resolveContextOptions({ scenario, locale, contextOptions = {}, variant }) {
  const v = normalizeVariant(variant);
  return {
    // 1. defaults that no variant controls
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    acceptDownloads: false,
    colorScheme: scenario.theme,
    locale: BROWSER_LOCALE[locale],
    // 2. caller's context options (tests)
    ...contextOptions,
    // 3+4. the variant (scenario's, then the run's) - always wins
    viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
    reducedMotion: MOTION[v.motion],
    forcedColors: v.forcedColors,
    contrast: v.contrast,
    timezoneId: v.timezone,
  };
}

/**
 * Root font size emulating a browser/OS text size of `fontScale` (the app's
 * type tokens are rem-based, so 1.25 renders the list step at 16.25px). The
 * app sets no root font-size of its own, so this matches what a user's
 * default font size does.
 */
export const fontScaleCss = (fontScale) => (fontScale === 1 ? "" : `html { font-size: ${16 * fontScale}px; }`);
