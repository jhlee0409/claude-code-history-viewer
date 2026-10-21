// Inner-UI probes (plan I0, §8 D criteria). Each probe reports
//
//   { population, selector, value, applicable, reason? }
//
// `population` is how many things it judged. A probe that applies to a
// scenario and judged nothing FAILS (an empty population proves nothing);
// a probe that does not apply says so (`applicable: false`) instead of
// passing vacuously. Which scenarios each probe applies to is declared here
// (`appliesTo`), not decided at run time from what happened to render.
//
//   absPathLeaks   D1  visible text showing an absolute path (POSIX roots,
//                      C:\, UNC, \\?\, /mnt/<drive>) outside code/output wells;
//                      title/aria/copy text never counts (it is not text)
//   toolRowMetrics D2  tool rows: font size, row box height, clipped names
//   wordBreak      D12 CJK text: computed word-break per language
//   cjkLeading     D12 multi-line CJK text with line-height / font-size < 1.5
//   leftEdges      D20 page title x vs first content column x (below the page
//                      header; Edits: file name column), distinct left edges
//   overflowX      D25 horizontal overflow (page and clipped/spilling boxes)
//   cards          D20 bordered rounded boxes, their nesting and radii
//   chromeSelect   D24 selectable text in the app chrome
//   focusVisible   D7  Tab stops whose focus is visible, on screen, uncovered
//   motionActivity D8  motion right after an interaction (--live only)

/* global document, window, getComputedStyle, innerWidth, innerHeight, NodeFilter */

import { measureMotion } from "./motion.mjs";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in Node, injected into the page as source)
// ---------------------------------------------------------------------------

/** Absolute paths in a text: POSIX system roots, drive letters, UNC, \\?\. */
export function findAbsolutePaths(text) {
  const found = [];
  const posix = /(^|[\s"'`(=:[{,])((?:\/(?:Users|home|opt|var|tmp|etc|usr|srv|mnt|root|private|Volumes|Library|System|workspace|data|app|nix|snap)\/)[^\s"'`<>()[\]{},;]+)/g;
  const windows = /(^|[\s"'`(=:[{,])((?:\\\\\?\\)?[A-Za-z]:\\[^\s"'`<>()[\]{},;]*)/g;
  const unc = /(^|[\s"'`(=[{,])(\\\\(?!\?\\)[A-Za-z0-9._$-]+\\[^\s"'`<>()[\]{},;]+)/g;
  for (const re of [posix, windows, unc]) {
    for (const match of String(text).matchAll(re)) found.push(match[2]);
  }
  return found;
}

const CJK_RE = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const KANA_RE = /[\u3040-\u30ff]/;

/** "ko" | "ja" | "zh" | null for a text, falling back to the element's lang. */
export function cjkLanguage(text, lang = "") {
  if (!CJK_RE.test(text)) return null;
  if (HANGUL_RE.test(text)) return "ko";
  if (KANA_RE.test(text)) return "ja";
  const l = String(lang).toLowerCase();
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("ko")) return "ko";
  return "zh";
}

/**
 * Failures of a probe result set: an applicable probe with an empty
 * population fails ("nothing measured" is not "nothing wrong").
 */
export function populationFailures(results) {
  return Object.entries(results)
    .filter(([, r]) => r.applicable && !(r.population > 0))
    .map(([name, r]) => `${name}: empty population (${r.selector})${r.reason ? ` - ${r.reason}` : ""}`);
}

// ---------------------------------------------------------------------------
// Applicability (declared per probe; screen id = scenario.screen.id)
// ---------------------------------------------------------------------------

const CJK_LOCALES = new Set(["ko", "ja", "zh-CN", "zh-TW"]);
const startsWithAny = (id, prefixes) => prefixes.some((p) => id === p || id.startsWith(`${p}-`));
const PATH_SCREENS = ["transcript", "recent-edits", "board", "inspector-info", "x-transcript-edit-expanded", "edits-patch-only"];
const TOOL_ROW_SCREENS = ["transcript", "x-transcript-edit-expanded"];
const WORK_SCREENS = ["analytics", "recent-edits", "board", "global-stats", "archive", "settings"];
const FOCUS_SCREENS = new Set(["home", "transcript", "settings"]);

/**
 * D20's "first content column" per screen (plan §8 D20): Edits measures the
 * file name column; other work screens the leftmost body text below the page
 * header (controls such as tabs and buttons are not a content column).
 */
export const contentColumnRule = (screen = "") => (startsWithAny(screen, ["recent-edits"]) ? "fileName" : "leftmostBody");

/** What the in-page probe code may read about its scenario. */
const probeContext = (ctx) => ({ screen: ctx.screen ?? "", contentColumn: contentColumnRule(ctx.screen) });

export const PROBE_APPLICABILITY = {
  absPathLeaks: ({ screen }) => startsWithAny(screen, PATH_SCREENS),
  toolRowMetrics: ({ screen }) => startsWithAny(screen, TOOL_ROW_SCREENS) && !screen.includes("dock"),
  wordBreak: ({ locale, screen }) => CJK_LOCALES.has(locale) || screen === "transcript-cjk",
  cjkLeading: ({ screen }) => screen === "transcript-cjk",
  leftEdges: ({ screen, mobile }) => !mobile && startsWithAny(screen, WORK_SCREENS),
  overflowX: () => true,
  cards: ({ screen }) => startsWithAny(screen, WORK_SCREENS),
  // Not with a modal open (palette, gear menu): the rest of the app is inert;
  // not on the terminal error screen, which replaces the app and its chrome.
  chromeSelect: ({ mobile, screen }) => !mobile && !screen.startsWith("palette") && screen !== "gear" && screen !== "error",
  focusVisible: ({ screen, mobile, theme, viewport }) => FOCUS_SCREENS.has(screen) && !mobile && theme === "dark" && viewport === "1440x900",
  motionActivity: ({ live }) => live,
};

// ---------------------------------------------------------------------------
// In-page measurement
// ---------------------------------------------------------------------------

const PAGE_LIB = `
  ${findAbsolutePaths.toString()}
  ${cjkLanguage.toString()}
  const CJK_RE = ${CJK_RE.toString()};
  const HANGUL_RE = ${HANGUL_RE.toString()};
  const KANA_RE = ${KANA_RE.toString()};
  const visible = (el) => {
    if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    if (el.closest('[aria-hidden="true"], .sr-only')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const textNodes = (root) => {
    const out = [];
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest("script,style,noscript,template") || !visible(el)) continue;
      out.push(n);
    }
    return out;
  };
  const describe = (el) => (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.getAttribute("class") ? "." + String(el.getAttribute("class")).split(/\\s+/).slice(0, 3).join(".") : "")).slice(0, 100);
  const lineCount = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top)));
    return tops.size;
  };
`;

/** Wells whose paths are content (code, tool output), not path UI. */
export const PATH_EXEMPT = 'pre, code, kbd, samp, textarea, input, [data-output], [data-code], [data-mono="code"], [data-mono="diag"], [data-path-kind="absolute"], [contenteditable="true"]';
export const TOOL_ROW_SELECTOR = '[data-tool-row], [data-message-uuid] button[aria-expanded]';
const CHROME_SELECTOR = 'header, nav, #project-explorer, [role="toolbar"], [role="tablist"], [data-slot="tabs"]';

const STATIC_PROBES = {
  absPathLeaks: `(() => {
    const selector = "body (text nodes; exempt: ${PATH_EXEMPT.replaceAll('"', '\\"')})";
    const leaks = [];
    let population = 0;
    for (const node of textNodes(document.body)) {
      if (node.parentElement.closest(${JSON.stringify(PATH_EXEMPT)})) continue;
      population += 1;
      for (const p of findAbsolutePaths(node.nodeValue)) leaks.push({ path: p.slice(0, 120), at: describe(node.parentElement) });
    }
    return { population, selector, value: { leaks: leaks.length, examples: leaks.slice(0, 8) } };
  })()`,
  toolRowMetrics: `(() => {
    const selector = ${JSON.stringify(TOOL_ROW_SELECTOR)};
    const rows = [...document.querySelectorAll(selector)].filter(visible);
    const fontSizes = {};
    const heights = [];
    let truncated = 0;
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      heights.push(Math.round(box.height * 100) / 100);
      const text = textNodes(row)[0];
      if (text) {
        const size = parseFloat(getComputedStyle(text.parentElement).fontSize);
        fontSizes[size] = (fontSizes[size] ?? 0) + 1;
      }
      for (const el of row.querySelectorAll("*")) {
        const s = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 1 && (s.textOverflow === "ellipsis" || s.overflowX === "hidden" || s.overflowX === "clip")) { truncated += 1; break; }
      }
    }
    heights.sort((a, b) => a - b);
    return { population: rows.length, selector, value: { fontSizes, minHeight: heights[0] ?? null, medianHeight: heights[Math.floor(heights.length / 2)] ?? null, truncatedRows: truncated } };
  })()`,
  wordBreak: `(() => {
    const selector = "body (visible text nodes with Hangul/Kana/Han)";
    const byLang = {};
    let population = 0;
    for (const node of textNodes(document.body)) {
      const el = node.parentElement;
      const lang = cjkLanguage(node.nodeValue, el.closest("[lang]")?.getAttribute("lang") ?? "");
      if (!lang) continue;
      population += 1;
      const wb = getComputedStyle(el).wordBreak;
      const bucket = (byLang[lang] ??= { total: 0, keepAll: 0, values: {} });
      bucket.total += 1;
      if (wb === "keep-all") bucket.keepAll += 1;
      bucket.values[wb] = (bucket.values[wb] ?? 0) + 1;
    }
    return { population, selector, value: { byLang } };
  })()`,
  cjkLeading: `(() => {
    // A node counts when it or its element wraps: with Korean keep-all a
    // text run often sits on one line inside a wrapped paragraph, and that
    // paragraph's line height is what a reader sees.
    const selector = "body (visible CJK text nodes in a multi-line element)";
    let population = 0;
    const tight = [];
    for (const node of textNodes(document.body)) {
      if (!cjkLanguage(node.nodeValue, "")) continue;
      if (lineCount(node) < 2 && lineCount(node.parentElement) < 2) continue;
      population += 1;
      const s = getComputedStyle(node.parentElement);
      const ratio = parseFloat(s.lineHeight) / parseFloat(s.fontSize);
      if (!(ratio >= 1.5)) tight.push({ at: describe(node.parentElement), ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : s.lineHeight });
    }
    return { population, selector, value: { below15: tight.length, examples: tight.slice(0, 6) } };
  })()`,
  leftEdges: `(() => {
    const main = document.querySelector('[data-slot="main"]') || document.getElementById("main-content");
    const selector = '[data-slot="main"] text nodes; title = first visible h1/h2/[role=heading]/[data-page-title]; content column = first text below the page header outside controls: the file name on Edits, else the leftmost (per scenario: contentRule)';
    if (!main) return { population: 0, selector, value: null };
    const nodes = textNodes(main);
    const leftOf = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getClientRects()[0];
      return r ? { x: Math.round(r.left), top: r.top } : null;
    };
    const lefts = {};
    for (const node of nodes) {
      const at = leftOf(node);
      if (at) lefts[at.x] = (lefts[at.x] ?? 0) + 1;
    }
    const heading = [...main.querySelectorAll('[data-page-title], h1, h2, [role="heading"]')].find(visible) ?? null;
    const headingX = heading ? Math.round(heading.getBoundingClientRect().left) : null;
    // The page header: a marked one, else main's child that holds the title
    // (icon, title, subtitle, actions); when that child also holds the body,
    // the title block (the title's parent: title + subtitle). Its text is
    // never "content", nor is anything above its bottom edge.
    let headerEl = null;
    if (heading) {
      headerEl = heading.closest("[data-page-header]");
      if (!headerEl || !main.contains(headerEl)) {
        let el = heading;
        while (el.parentElement && el.parentElement !== main) el = el.parentElement;
        headerEl = nodes.some((n) => !el.contains(n)) ? el : heading.parentElement;
      }
    }
    const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : -Infinity;
    const CONTROL = 'button, [role="button"], [role="tab"], [role="tablist"], [role="toolbar"], [role="radiogroup"], [role="menubar"], label, select, input, textarea';
    const body = [];
    for (const node of nodes) {
      if (headerEl && headerEl.contains(node)) continue;
      if (node.parentElement.closest(CONTROL)) continue;
      const at = leftOf(node);
      if (!at || at.top < headerBottom - 1) continue;
      body.push({ node, x: at.x });
    }
    // The content column (plan §8 D20): on Edits the file name column (the
    // first text that is a bare file name); elsewhere the leftmost body text.
    const FILE_NAME = /^[^\\s\\/\\\\]+\\.[A-Za-z0-9]{1,8}$/;
    let content = null;
    if (CTX.contentColumn === "fileName") content = body.find((b) => FILE_NAME.test(b.node.nodeValue.trim())) ?? null;
    else for (const b of body) if (!content || b.x < content.x) content = b;
    const contentX = content ? content.x : null;
    const distinct = Object.entries(lefts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([x, n]) => ({ x: Number(x), n }));
    return {
      population: nodes.length,
      selector,
      value: {
        headingX,
        contentX,
        delta: headingX !== null && contentX !== null ? contentX - headingX : null,
        contentRule: CTX.contentColumn,
        contentAt: content ? describe(content.node.parentElement) + " " + JSON.stringify(content.node.nodeValue.trim().slice(0, 40)) : null,
        distinctEdges: Object.keys(lefts).length,
        top: distinct,
      },
    };
  })()`,
  overflowX: `(() => {
    const selector = "body * (visible elements)";
    const doc = document.scrollingElement || document.documentElement;
    const offenders = [];
    let population = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (!visible(el)) continue;
      population += 1;
      if (el.closest("pre, code, [data-output], [data-code]")) continue;
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX)) continue; // scrolls on purpose
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && s.textOverflow !== "ellipsis") {
        offenders.push({ at: describe(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    }
    return { population, selector, value: { pageOverflowPx: Math.max(0, doc.scrollWidth - innerWidth), clipped: offenders.length, examples: offenders.slice(0, 8) } };
  })()`,
  cards: `(() => {
    const main = document.querySelector('[data-slot="main"]') || document.getElementById("main-content") || document.body;
    const selector = '[data-slot="main"] * (visible, >=40x24)';
    const isCard = (el) => {
      const s = getComputedStyle(el);
      const sides = ["Top", "Right", "Bottom", "Left"].every((k) => parseFloat(s["border" + k + "Width"]) >= 1 && s["border" + k + "Style"] !== "none");
      return sides && parseFloat(s.borderTopLeftRadius) >= 4;
    };
    let population = 0;
    const radii = {};
    let count = 0;
    let maxNesting = 0;
    for (const el of main.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue;
      population += 1;
      if (!isCard(el)) continue;
      count += 1;
      const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      const radius = raw >= Math.min(r.width, r.height) / 2 ? "pill" : Math.round(raw);
      radii[radius] = (radii[radius] ?? 0) + 1;
      let depth = 1;
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (isCard(p)) depth += 1;
      maxNesting = Math.max(maxNesting, depth);
    }
    return { population, selector, value: { cards: count, maxNesting, radii } };
  })()`,
  chromeSelect: `(() => {
    const selector = ${JSON.stringify(CHROME_SELECTOR)} + " (text nodes outside inputs)";
    let population = 0;
    let selectable = 0;
    const examples = [];
    for (const root of document.querySelectorAll(${JSON.stringify(CHROME_SELECTOR)})) {
      if (root.parentElement?.closest(${JSON.stringify(CHROME_SELECTOR)})) continue;
      for (const node of textNodes(root)) {
        const el = node.parentElement;
        if (el.closest("input, textarea, [contenteditable=true]")) continue;
        population += 1;
        const s = getComputedStyle(el);
        const us = s.webkitUserSelect || s.userSelect;
        if (us !== "none") { selectable += 1; if (examples.length < 6) examples.push({ at: describe(el), text: node.nodeValue.trim().slice(0, 40) }); }
      }
    }
    return { population, selector, value: { selectable, examples } };
  })()`,
};

const FOCUS_INFO = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const r = el.getBoundingClientRect();
  const inView = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
  const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
  const hit = document.elementFromPoint(cx, cy);
  const covered = !hit || !(hit === el || el.contains(hit) || hit.contains(el));
  if (!el.hasAttribute("data-ui-focus-probe")) el.setAttribute("data-ui-focus-probe", String(document.querySelectorAll("[data-ui-focus-probe]").length));
  return { key: el.getAttribute("data-ui-focus-probe"), at: (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")).slice(0, 60), name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), inView, covered, box: { x: r.left, y: r.top, width: r.width, height: r.height } };
})()`;

/**
 * Tab through up to `maxStops` stops; for each, crop focused vs. blurred and
 * call the focus visible when the crop changes (> 0.2% of pixels by more
 * than 24 levels in a channel) - the same judgement as `ui:states`.
 */
async function probeFocusVisible(page, { maxStops = 24 } = {}) {
  const { focusChange } = await import("./statesJudge.mjs");
  await page.evaluate(() => {
    document.activeElement?.blur?.();
  });
  await page.mouse.move(1, 1);
  // WebKit's plain Tab skips buttons (macOS without Full Keyboard Access);
  // Alt+Tab walks every control, which is what a keyboard user turns on.
  const engine = page.context().browser()?.browserType().name() ?? "webkit";
  const tabKey = engine === "webkit" ? "Alt+Tab" : "Tab";
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < maxStops; i += 1) {
    await page.keyboard.press(tabKey);
    const info = await page.evaluate(FOCUS_INFO);
    if (!info) continue;
    if (seen.has(info.key)) break; // wrapped around
    seen.add(info.key);
    let visibleRing = null;
    if (info.inView) {
      const pad = 6;
      const clip = {
        x: Math.max(0, info.box.x - pad),
        y: Math.max(0, info.box.y - pad),
        width: Math.max(1, info.box.width + pad * 2),
        height: Math.max(1, info.box.height + pad * 2),
      };
      const focused = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
      await page.evaluate(() => document.activeElement?.blur?.());
      const blurred = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
      visibleRing = focusChange(focused, blurred).visible;
      // Back to the same stop programmatically; the next Tab moves on from it.
      await page.evaluate((key) => document.querySelector(`[data-ui-focus-probe="${key}"]`)?.focus(), info.key);
    }
    stops.push({ ...info, visible: visibleRing });
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  const judged = stops.filter((s) => s.inView);
  return {
    population: stops.length,
    selector: `first ${maxStops} ${tabKey} stops from the top of the page`,
    value: {
      visible: judged.filter((s) => s.visible && !s.covered).length,
      invisible: judged.filter((s) => !s.visible).length,
      covered: judged.filter((s) => s.covered).length,
      offscreen: stops.length - judged.length,
      examplesInvisible: judged.filter((s) => !s.visible).slice(0, 8).map((s) => `${s.at} ${s.name}`),
    },
  };
}

async function probeMotionActivity(page) {
  const opener = page.locator('[data-slot="main"] [aria-expanded="false"]:not([aria-haspopup])').first();
  if ((await opener.count()) === 0) return { population: 0, selector: '[data-slot="main"] [aria-expanded=false]', value: null };
  const motion = await measureMotion(page, () => opener.click());
  return { population: 1, selector: '[data-slot="main"] [aria-expanded=false] (first; clicked)', value: motion };
}

/**
 * Run every inner probe for one scenario. `ctx` = { screen, locale, mobile,
 * theme, viewport, live }. Static probes run first (no interaction), then
 * focusVisible and motionActivity (they change focus/expansion), so run
 * this after the screenshot.
 */
export async function runInnerProbes(page, ctx, { only = null } = {}) {
  const results = {};
  for (const [name, applies] of Object.entries(PROBE_APPLICABILITY)) {
    if (only && !only.includes(name)) continue;
    if (!applies(ctx)) {
      results[name] = { applicable: false, population: null, selector: null, value: null };
      continue;
    }
    let measured;
    if (name in STATIC_PROBES) measured = await page.evaluate(staticProbeSource(name, ctx));
    else if (name === "focusVisible") measured = await probeFocusVisible(page);
    else if (name === "motionActivity") measured = await probeMotionActivity(page);
    results[name] = { applicable: true, ...measured };
  }
  return results;
}

/** The page source of one static probe for a scenario `ctx` (tests run it directly). */
export const staticProbeSource = (name, ctx = {}) =>
  `(() => { ${PAGE_LIB} const CTX = ${JSON.stringify(probeContext(ctx))}; return ${STATIC_PROBES[name]}; })()`;
