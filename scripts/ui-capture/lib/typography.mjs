// Typography probe and checks (plan T4 VERIFY, §9b C5).
//
//   TYPOGRAPHY_PROBE   in-page: html[lang], --app-font-scale, body
//                      font-family, the computed size / line height of each
//                      type step (a hidden probe span per step class), and
//                      the sizes visible elements with a step class render at
//   checkTypography    problems against the expected locale and scale:
//                      lang, scale, font order, body line height, each step =
//                      base × scale ±0.5px, min font >= 12px at 100%
//
// Mirrors decision.html §4 (type scale) and §5 (per-language font order);
// src/index.css holds the real values.

/** Type steps at 100 % (px): the five tokens + analytics-number aliases. */
export const TYPE_STEPS = { caption: 12, list: 13, body: 15, code: 13, title: 17, lg: 18, xl: 20, "2xl": 24 };

/** Expected computed font-family per app locale (decision.html §5). */
export const FONT_STACKS = {
  en: ["IBM Plex Sans", "-apple-system", "Segoe UI", "sans-serif"],
  ko: ["IBM Plex Sans", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "sans-serif"],
  ja: ["IBM Plex Sans", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", "Noto Sans CJK JP", "sans-serif"],
  "zh-CN": ["IBM Plex Sans", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", "Noto Sans CJK SC", "sans-serif"],
  "zh-TW": ["IBM Plex Sans", "PingFang TC", "Microsoft JhengHei UI", "Noto Sans TC", "Noto Sans CJK TC", "sans-serif"],
};

/** Body-step line height per locale: CJK 1.7, English 1.55. */
export const BODY_LINE_HEIGHT = { en: 1.55, ko: 1.7, ja: 1.7, "zh-CN": 1.7, "zh-TW": 1.7 };

/** Smallest rendered text at 100 % (D9). */
export const MIN_FONT_PX = 12;

const SIZE_TOLERANCE_PX = 0.5;
const LINE_HEIGHT_TOLERANCE = 0.01;

export const TYPOGRAPHY_PROBE = `(() => {
  const steps = ${JSON.stringify(Object.keys(TYPE_STEPS))};
  const html = document.documentElement;
  const scaleValue = parseFloat(getComputedStyle(html).getPropertyValue("--app-font-scale"));
  // Hidden probe spans: the step's own computed value, even when the screen
  // does not use that step. Runs after the screenshot.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;";
  document.body.appendChild(host);
  const measured = {};
  for (const step of steps) {
    const span = document.createElement("span");
    span.className = "text-" + step;
    span.style.display = "block";
    span.textContent = "Ag";
    host.appendChild(span);
    const style = getComputedStyle(span);
    measured[step] = { fontSize: parseFloat(style.fontSize), lineHeight: style.lineHeight };
  }
  host.remove();
  // What visible elements carrying a step class actually render at. An
  // element that also has a responsive step variant (\`text-body
  // md:text-list\`) is skipped: which step is active depends on the viewport.
  const stepVariant = new RegExp(":text-(" + steps.join("|") + ")$");
  const used = {};
  const usedAt = {};
  for (const step of steps) {
    const sizes = new Map();
    for (const element of document.querySelectorAll(".text-" + CSS.escape(step))) {
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if ([...element.classList].some((name) => stepVariant.test(name))) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (!sizes.has(size)) sizes.set(size, String(element.getAttribute("class") || "").slice(0, 120));
    }
    used[step] = [...sizes.keys()].sort((a, b) => a - b);
    usedAt[step] = Object.fromEntries(sizes);
  }
  return {
    lang: html.lang,
    appFontScale: Number.isFinite(scaleValue) ? scaleValue : null,
    bodyFontFamily: getComputedStyle(document.body).fontFamily,
    steps: measured,
    used,
    usedAt,
  };
})()`;

/** `"IBM Plex Sans", -apple-system, sans-serif` → ["IBM Plex Sans", "-apple-system", "sans-serif"] */
export function parseFontFamily(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Problems of one capture's typography against the expected locale and font
 * scale. `minFontPx` is the min-font probe (null when nothing was sampled).
 */
export function checkTypography(typography, { locale, scalePercent, minFontPx, rootScale = 1 }) {
  const problems = [];
  if (!typography) return ["no typography probe recorded"];
  // `scalePercent`: the app's own font setting (--app-font-scale);
  // `rootScale`: the browser/OS text size (--font-scale variant, root font
  // size). The rem-based steps scale with both.
  const appScale = scalePercent / 100;
  const scale = appScale * rootScale;
  if (typography.lang !== locale) problems.push(`html[lang] "${typography.lang}", expected "${locale}"`);
  if (typography.appFontScale === null || Math.abs(typography.appFontScale - appScale) > 1e-6) {
    problems.push(`--app-font-scale ${typography.appFontScale}, expected ${appScale}`);
  }
  for (const [step, base] of Object.entries(TYPE_STEPS)) {
    const expected = round2(base * scale);
    const got = typography.steps?.[step]?.fontSize;
    if (typeof got !== "number" || Math.abs(got - expected) > SIZE_TOLERANCE_PX) {
      problems.push(`step ${step} ${got}px, expected ${expected}px (${base} × ${scale})`);
    }
    for (const size of typography.used?.[step] ?? []) {
      if (Math.abs(size - expected) > SIZE_TOLERANCE_PX) problems.push(`text-${step} rendered at ${size}px, expected ${expected}px`);
    }
  }
  const family = parseFontFamily(typography.bodyFontFamily);
  const expectedFamily = FONT_STACKS[locale];
  if (expectedFamily && family.join(", ") !== expectedFamily.join(", ")) {
    problems.push(`font-family "${family.join(", ")}", expected "${expectedFamily.join(", ")}"`);
  }
  const body = typography.steps?.body;
  if (body && BODY_LINE_HEIGHT[locale]) {
    const ratio = round2(parseFloat(body.lineHeight) / body.fontSize);
    if (!Number.isFinite(ratio) || Math.abs(ratio - BODY_LINE_HEIGHT[locale]) > LINE_HEIGHT_TOLERANCE) {
      problems.push(`body line height ${ratio}, expected ${BODY_LINE_HEIGHT[locale]}`);
    }
  }
  if (typeof minFontPx === "number") {
    // D9: >= 12px at 100 %; scaled runs get the same ±0.5px as the steps.
    const floor = scale === 1 ? MIN_FONT_PX : round2(MIN_FONT_PX * scale) - SIZE_TOLERANCE_PX;
    if (minFontPx < floor) problems.push(`min font ${minFontPx}px < ${floor}px at ${round2(scale * 100)}%`);
  }
  return problems;
}
