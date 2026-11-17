// Numbers never break inside themselves (inner-UI plan F1b, CJK wrapping).
//
// Real WebKit, 390x844 with root font scale 125 % (130 %, the largest app
// setting, where noted), in every CJK UI language.
// Every number in UI text is measured with a DOM Range: its sign, digits,
// separators and what is glued to it (17.6K, 3.5%, 62×, 1.8⁠만, 7일, 2.1초, also
// when the unit is the next text node, after <Num>'s span) must render on one
// line. A unit after a space (1.4 MB) may move to the next line, as on
// develop. Code, paths and ids are not numbers and are skipped.
//
// Four mechanisms split numbers in the Korean UI, all pinned here:
//   - `overflow-wrap: anywhere` counts its break points in min-content, so a
//     squeezed flex or grid item shrinks to one character: 69 -> 6/9 on the
//     board, 1.4 MB -> 1/./4/M/B on the archive's expiry cards. The base layer
//     uses `break-word`, which never lowers min-content.
//   - WebKit breaks a keep-all text node that holds Hangul after every
//     punctuation mark, so a date and time rendered as one text node
//     ("… 오후 01:26:25", the message header's details popover) wraps after
//     "01:".
//   - WebKit's keep-all also lowers a squeezed flex item's min-content at the
//     punctuation inside a number, ASCII included: 7,803 -> 7,/803 and
//     1.8⁠만 -> 1./8⁠만 on the board, the token statistics and the global
//     statistics, $270.29 in the cost rows, 1.3 MB in the archive (the shared
//     formatters' F3b formats). Both are fixed by <Num> (src/lib/format/Num.tsx):
//     every formatter result shown as text renders through it, and its numbers
//     get `word-break: normal`, under which Unicode never breaks a number.
//   - `break-word` still breaks a single word wider than its whole line. A
//     number gets there only in a box forced narrower than itself, where
//     every language overflows: the token KPI tiles on a phone at 130 %
//     (526.5K -> 526.5/K). Such a value is `whitespace-nowrap`.
// Before <Num> (UI_TEST_DIST=<b20eb16c build>) the Korean board, archive and
// KPI cases fail; before the earlier fixes (027986fb, ad107289) the archive,
// transcript and KPI cases did. On develop the Korean archive fails on its
// glued units alone (7일, 1개 split from their counters, the core whole).
// Skipped without WebKit or a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, NodeFilter */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "cjk.numericAtomic.test" }).enabled;

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("cjk-numeric-atomic");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/**
 * Every number in visible UI text: `core` (sign, digits, separators, a glued
 * K/M/B/T, % or ×), its unit (glued, or after a space), the text around it,
 * and the lines that the core and its glued unit span together (`lines`;
 * `coreLines` for the core alone). A glued unit may be the next text node in
 * the same line box (<Num>'s `<span data-num>2.1</span>초`). A unit after a
 * space may wrap. Popovers hidden by opacity count: they are laid out and
 * shown on hover.
 */
const numbersOnPage = (page) =>
  page.evaluate(() => {
    const UNIT = String.raw`\u2060?(?:KB|MB|GB|TB|kB|ms|만|억|천|万|亿|萬|億|千|분|초|시간|일|개|회|건|件|個|个|回|次|秒|分|小时|時間|天|日|[smhdx%])`;
    const TOKEN = new RegExp(
      String.raw`(?<![\p{L}\p{N}_.,:/\\-])(?<core>[+\-\u2212]?\d+(?:[.,:/-]\d+)*(?:[KkMBT](?!\p{L}))?(?:%|\u00d7)?)(?<unit>${UNIT})?(?<spaced>[ \u00a0](?:KB|MB|GB|TB|kB|B|ms|s|K|M))?(?![\p{L}\p{N}_])`,
      "gu",
    );
    const GLUED = new RegExp(String.raw`^${UNIT}(?![\p{L}\p{N}_])`, "u");
    const SKIP = 'pre, code, kbd, samp, textarea, input, [contenteditable="true"]';
    const lines = (startNode, start, endNode, end) => {
      const range = document.createRange();
      range.setStart(startNode, start);
      range.setEnd(endNode, end);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.3 && r.height > 0);
      return rects.length ? new Set(rects.map((r) => Math.round(r.top))).size : 0;
    };
    // The box whose lines a text node is laid out on: its nearest ancestor that is not inline.
    const lineBox = (el) => {
      let box = el;
      while (box.parentElement && ["inline", "contents"].includes(getComputedStyle(box).display)) box = box.parentElement;
      return box;
    };
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
    const out = [];
    texts.forEach((n, i) => {
      const text = n.nodeValue ?? "";
      const el = n.parentElement;
      if (!el || !el.checkVisibility() || el.closest(SKIP)) return;
      // Paths and ids (a/b, 41ac2d22cac2…) may wrap anywhere; they are not numbers.
      if (/\w[\\/]\w/.test(text) || /[0-9a-f]{12,}/i.test(text)) return;
      // The text around the number: the nearest element that holds more than
      // this text node (a number in its own span sits in a phrase).
      let host = el;
      while (host.parentElement && (host.textContent ?? "").trim() === text.trim()) host = host.parentElement;
      const context = (host.textContent ?? text).trim().slice(0, 80);
      const next = texts[i + 1];
      for (const m of text.matchAll(TOKEN)) {
        const { core, unit = "", spaced = "" } = m.groups;
        const coreEnd = m.index + core.length;
        const coreLines = lines(n, m.index, n, coreEnd);
        if (!coreLines) continue;
        let glued = unit;
        let gluedLines = unit ? lines(n, m.index, n, coreEnd + unit.length) : coreLines;
        if (!unit && !spaced && coreEnd === text.length && next?.parentElement && lineBox(next.parentElement) === lineBox(el)) {
          const after = GLUED.exec(next.nodeValue ?? "");
          if (after) {
            glued = after[0];
            gluedLines = lines(n, m.index, next, after[0].length);
          }
        }
        out.push({ text: m[0] + (glued === unit ? "" : glued), core, unit: glued || spaced.trim(), context, coreLines, lines: Math.max(coreLines, gluedLines) });
      }
    });
    return out;
  });

/** Open `id`, run `prepare` (scrolling, expanding), and measure every number on the page. */
async function measure(id, locale, prepare = async () => {}, fontScale = 1.25) {
  const session = await openScenario(browser, app, id, { locale, variant: { fontScale } });
  try {
    await prepare(session.page);
    return await numbersOnPage(session.page);
  } finally {
    await session.close();
  }
}

const split = (numbers) => numbers.filter((n) => n.lines > 1);
const LOCALES = ["ko", "ja", "zh-CN"];

describe.skipIf(!ENABLED)("numbers never break inside themselves (real WebKit, 390x844)", () => {
  it.each(LOCALES)("%s UI, board at 125%: every metric renders on one line", async (locale) => {
    const numbers = await measure("board--390x844--dark", locale);
    expect(numbers.length, "no numbers visible on the board to measure").toBeGreaterThan(10);
    expect(split(numbers), JSON.stringify(split(numbers))).toEqual([]);
  }, 120_000);

  it.each(LOCALES)("%s UI, archive at 125%: file sizes in the expiry cards keep their number on one line (UI font, no class)", async (locale) => {
    const numbers = await measure("archive--390x844--dark", locale, async (page) => {
      // The expiry cards sit below the fold: bring each size into view as a user would.
      const sizes = page.getByText(/^\d[\d,.]*\s?(?:B|KB|MB|GB|TB)$/);
      for (let i = 0; i < (await sizes.count()); i += 1) await sizes.nth(i).scrollIntoViewIfNeeded();
    });
    const sizes = numbers.filter((n) => /^(?:B|KB|MB|GB|TB)$/.test(n.unit));
    expect(sizes.length, "no file sizes on the archive to measure").toBeGreaterThan(0);
    expect(split(numbers), JSON.stringify(split(numbers))).toEqual([]);
  }, 120_000);

  it.each(LOCALES)("%s UI, transcript at 125%: message times, also inside a localized date in the details popover, stay whole", async (locale) => {
    const numbers = await measure("transcript-mixed-turn--390x844--dark", locale);
    const times = numbers.filter((n) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(n.core) && /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(n.context));
    expect(times.length, "no localized message times to measure").toBeGreaterThan(0);
    expect(split(numbers), JSON.stringify(split(numbers))).toEqual([]);
  }, 120_000);

  it.each(LOCALES)("%s UI, token statistics at 130% (the largest font size): KPI values stay whole in tiles narrower than the value", async (locale) => {
    // The KPI values are whatever the formatter writes (17.6K, 52.7⁠만, 1.8万,
    // 7,803): each tile's value element is measured whole, by its place in
    // the tile, not by a number pattern.
    let kpis = [];
    const numbers = await measure(
      "analytics-tokens--390x844--dark",
      locale,
      async (page) => {
        const tiles = page.locator("button[aria-label] > div.font-mono");
        await tiles.first().scrollIntoViewIfNeeded();
        kpis = await tiles.evaluateAll((values) =>
          values.map((value) => {
            const range = document.createRange();
            range.selectNodeContents(value);
            const rects = [...range.getClientRects()].filter((r) => r.width > 0.3 && r.height > 0);
            return { text: value.textContent ?? "", lines: new Set(rects.map((r) => Math.round(r.top))).size };
          }),
        );
      },
      1.3,
    );
    expect(kpis.filter((kpi) => /\d/.test(kpi.text)).length, "no KPI values on the token statistics to measure").toBeGreaterThan(2);
    expect(kpis.filter((kpi) => kpi.lines !== 1), JSON.stringify(kpis)).toEqual([]);
    expect(split(numbers), JSON.stringify(split(numbers))).toEqual([]);
  }, 120_000);
});
