// CJK line breaking and line height in the running app (inner-UI plan F1b,
// D12, G-CJ2 / G-CJ3).
//
// Real WebKit, the real app in each CJK UI language, on the Korean session
// that mixes prose, paths and code (transcript-cjk) and on the sidebar /
// home. Uses the harness's own `wordBreak` / `cjkLeading` probes.
//   - Korean UI: every visible Korean text node breaks between words
//     (word-break: keep-all);
//   - Japanese / Chinese UI: no Japanese or Chinese node is keep-all (it
//     would glue whole sentences);
//   - caption- and list-size text that wraps onto several lines has a line
//     height of at least 1.5 in every CJK UI.
// Before F1b (UI_TEST_DIST=<base dist>) the Korean and line-height checks
// fail. Skipped without WebKit or without a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { staticProbeSource } from "../lib/innerProbes.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, NodeFilter */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "cjk.wordBreak.test" }).enabled;

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("cjk-wordbreak");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Multi-line CJK text nodes set in the caption / list type steps, and their line-height ratio. */
const smallStepLeading = (page) =>
  page.evaluate(() => {
    const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
    const steps = ["--text-caption", "--text-list"].map((name) => {
      const probe = document.createElement("div");
      probe.style.fontSize = `var(${name})`;
      document.body.appendChild(probe);
      const px = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      return px;
    });
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!CJK.test(n.nodeValue ?? "")) continue;
      const el = n.parentElement;
      if (!el || !el.checkVisibility()) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (!steps.some((px) => Math.abs(px - size) < 0.01)) continue;
      // Only the type token's own line height: an explicit leading-* utility is a component's choice (later tasks).
      if (/(^|\s)leading-/.test(el.getAttribute("class") ?? "")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top))).size;
      if (lines < 2) continue;
      out.push({ text: (n.nodeValue ?? "").slice(0, 24), ratio: Math.round((parseFloat(cs.lineHeight) / size) * 100) / 100 });
    }
    return out;
  });

const SCREENS = ["transcript-cjk--1440x900--light", "transcript-cjk--390x844--dark", "home--1440x900--light"];

describe.skipIf(!ENABLED)("CJK line breaking (real WebKit)", () => {
  it.each(SCREENS)("Korean UI, %s: every Korean text node is keep-all", async (id) => {
    const session = await openScenario(browser, app, id, { locale: "ko" });
    try {
      const probe = await session.page.evaluate(staticProbeSource("wordBreak"));
      const ko = probe.value.byLang.ko;
      expect(ko?.total ?? 0, JSON.stringify(probe.value)).toBeGreaterThan(0);
      expect(ko.keepAll, JSON.stringify(probe.value)).toBe(ko.total);
    } finally {
      await session.close();
    }
  }, 120_000);

  it.each(["ja", "zh-CN", "zh-TW"])("%s UI: no Japanese or Chinese text node is keep-all", async (locale) => {
    const session = await openScenario(browser, app, "home--1440x900--light", { locale });
    try {
      const probe = await session.page.evaluate(staticProbeSource("wordBreak"));
      const nodes = ["ja", "zh"].map((lang) => probe.value.byLang[lang]).filter(Boolean);
      expect(nodes.reduce((sum, b) => sum + b.total, 0), JSON.stringify(probe.value)).toBeGreaterThan(0);
      for (const bucket of nodes) expect(bucket.keepAll, JSON.stringify(probe.value)).toBe(0);
      const lineBreak = await session.page.evaluate(() => getComputedStyle(document.body).getPropertyValue("line-break"));
      expect(lineBreak).toBe("strict");
    } finally {
      await session.close();
    }
  }, 120_000);

  it.each(["ko", "ja", "zh-CN", "zh-TW"])("%s UI: wrapped caption / list text has line height ≥ 1.5 (Korean session, settings; 390)", async (locale) => {
    const nodes = [];
    for (const id of ["transcript-cjk--390x844--dark", "settings--390x844--dark"]) {
      const session = await openScenario(browser, app, id, { locale });
      try {
        nodes.push(...(await smallStepLeading(session.page)).map((n) => ({ ...n, id })));
      } finally {
        await session.close();
      }
    }
    expect(nodes.length, "no wrapped caption/list CJK text to measure").toBeGreaterThan(0);
    expect(nodes.filter((n) => n.ratio < 1.5)).toEqual([]);
  }, 180_000);
});
