// The opened Edit, measured in real WebKit (plan TR2a VERIFY, acceptance D4).
//
// Scenario `x-transcript-edit-expanded`: the mixed-turn session with its
// Edit of src/preview/renderPreview.ts opened. That record is the frozen
// standard meta fixture (fixtures/inner.mjs: Edit, partial replace,
// `userModified: false`), so the opened detail is ONE meta line → DiffView.
//
// - 1440x900 en: the Edit row's bottom edge → the first diff code line's
//   top edge ≤ 40px, not counting the Input zone's label line (IO zones,
//   owner option B: the diff is the recorded change = Input, so its zone
//   label is the one thing allowed above the meta line); the diff is the
//   meta line's next element; nothing in the meta line is clipped.
// - 1440x900 ko at font scale 125%: the meta line may wrap, but nothing is
//   clipped and the order (row → meta → diff) holds.
// - 390x844 en and ko: the row's path stays on one line, the meta line is
//   one line (no chip row), nothing clipped, order holds.
//
// Before TR2a (12e952c0) the opened Edit was the old box (second header,
// absolute path well, Edit Type / User Modified chips, Changes toolbar,
// Advanced Text Analysis box) and there is no meta line: run with
// UI_TEST_DIST=<base dist> to see it fail. Skipped without WebKit or a
// built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, innerWidth */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "editExpanded.test" }).enabled;

const CONFIGS = [
  { label: "1440x900 en", scenario: "x-transcript-edit-expanded--1440x900--dark", locale: "en", variant: {}, distance: true, phone: false },
  { label: "1440x900 ko, font scale 125%", scenario: "x-transcript-edit-expanded--1440x900--dark", locale: "ko", variant: { fontScale: 1.25 }, distance: false, phone: false },
  { label: "390x844 en", scenario: "x-transcript-edit-expanded--390x844--dark", locale: "en", variant: {}, distance: false, phone: true },
  { label: "390x844 ko", scenario: "x-transcript-edit-expanded--390x844--dark", locale: "ko", variant: {}, distance: false, phone: true },
];

/** Everything the assertions need, measured in the page. */
const measure = (page) =>
  page.evaluate(() => {
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), height: +r.height.toFixed(2) });
    const textRects = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0).map(rect);
    };
    /** Visual lines of a set of rects: rects that overlap vertically share a line. */
    const lineCount = (rects) => {
      const lines = [];
      for (const r of [...rects].sort((a, b) => a.top - b.top)) {
        const line = lines.find((l) => r.top < l.bottom - 1 && r.bottom > l.top + 1);
        if (line) {
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
        } else lines.push({ top: r.top, bottom: r.bottom });
      }
      return lines.length;
    };

    const meta = document.querySelector("[data-edit-meta]");
    if (!meta) {
      const detail = document.querySelector("[data-tool-detail]:not([hidden])");
      return { found: false, detail: (detail?.innerText ?? "").slice(0, 300) };
    }
    const wrapper = meta.closest("[data-tool-row-wrapper]");
    const row = wrapper.querySelector("[data-tool-row]");
    const detail = wrapper.querySelector("[data-tool-detail]");
    const next = meta.nextElementSibling;
    const firstCode = next?.querySelector("[data-diff-line] [data-diff-code]") ?? null;
    const firstCodeLine = firstCode ? textRects(firstCode)[0] ?? rect(firstCode.getBoundingClientRect()) : null;
    const metaBox = rect(meta.getBoundingClientRect());
    // The Input zone around the diff: its label line and the space before its body.
    const zone = meta.closest("[data-detail-zone]");
    const zoneBody = zone?.children[1] ?? null;
    const zoneLabel = zone ? { kind: zone.getAttribute("data-detail-zone"), labelLine: !!zone.children[0]?.hasAttribute("data-zone-label"), span: zoneBody ? +(zoneBody.getBoundingClientRect().top - zone.getBoundingClientRect().top).toFixed(2) : null } : null;
    const detailBox = rect(detail.getBoundingClientRect());
    const viewport = innerWidth;

    // Every piece of the meta line: its text line boxes and its controls.
    const pieces = [];
    const walker = document.createTreeWalker(meta, 4 /* SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const host = node.parentElement;
      if (!host || host.closest(".sr-only") || (node.nodeValue ?? "").trim() === "") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0.5) pieces.push({ what: `text "${node.nodeValue.trim()}"`, rect: rect(r) });
    }
    const controls = [...meta.querySelectorAll("button")].map((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { what: `button "${button.getAttribute("aria-label") ?? button.textContent}"`, rect: rect(r), hit: !!hit && (hit === button || button.contains(hit)) };
    });
    let ellipsis = false;
    for (const el of [meta, ...meta.querySelectorAll("*")]) {
      const s = getComputedStyle(el);
      if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) ellipsis = true;
    }

    const path = row.querySelector("[data-path]");
    return {
      found: true,
      viewport,
      metaText: meta.innerText.replace(/\s+/g, " ").trim(),
      row: rect(row.getBoundingClientRect()),
      meta: metaBox,
      metaLines: lineCount(pieces.map((p) => p.rect)),
      metaOverflow: meta.scrollWidth > meta.clientWidth + 1,
      ellipsis,
      detail: detailBox,
      nextIsDiff: !!next?.hasAttribute("data-diff-view"),
      next: next ? next.outerHTML.slice(0, 160) : null,
      diff: next ? rect(next.getBoundingClientRect()) : null,
      firstCodeLine,
      zoneLabel,
      pieces,
      controls,
      pathLines: path ? lineCount(textRects(path)) : null,
      pathText: path?.textContent ?? null,
    };
  });

const inside = (r, box) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("edit-expanded");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe.skipIf(!ENABLED)("opened Edit: row → one meta line → DiffView (real WebKit, D4)", () => {
  describe.each(CONFIGS)("$label", (config) => {
    let m;
    let session;

    beforeAll(async () => {
      session = await openScenario(browser, app, config.scenario, { locale: config.locale, variant: config.variant });
      await session.page.evaluate(() => document.querySelector("[data-edit-meta]")?.scrollIntoView({ block: "center" }));
      m = await measure(session.page);
    }, 240_000);

    afterAll(async () => {
      await session?.close();
    });

    it("the opened Edit has a meta line and the DiffView is its next element", () => {
      expect(m.found, `no meta line; opened detail: ${m.detail}`).toBe(true);
      expect(m.nextIsDiff, `element after the meta line: ${m.next}`).toBe(true);
      expect(m.firstCodeLine, "a first diff code line").not.toBeNull();
    });

    it("order holds: row above the meta line, the meta line above the diff", () => {
      expect(m.found, `no meta line; opened detail: ${m.detail}`).toBe(true);
      const detail = JSON.stringify({ row: m.row, meta: m.meta, diff: m.diff });
      expect(m.meta.top, detail).toBeGreaterThanOrEqual(m.row.bottom - 0.5);
      expect(m.diff.top, detail).toBeGreaterThanOrEqual(m.meta.bottom - 0.5);
    });

    it("nothing in the meta line is clipped", () => {
      expect(m.found, `no meta line; opened detail: ${m.detail}`).toBe(true);
      const detail = JSON.stringify(m);
      expect(m.metaOverflow, `meta line overflows: ${detail}`).toBe(false);
      expect(m.ellipsis, `meta text ellipsised: ${detail}`).toBe(false);
      expect(m.pieces.length + m.controls.length, detail).toBeGreaterThan(0);
      for (const piece of [...m.pieces, ...m.controls]) {
        expect(inside(piece.rect, m.meta), `${piece.what} outside the meta line: ${detail}`).toBe(true);
        expect(piece.rect.left >= m.detail.left - 0.5 && piece.rect.right <= Math.min(m.detail.right, m.viewport) + 0.5, `${piece.what} outside the column: ${detail}`).toBe(true);
      }
      for (const control of m.controls) expect(control.hit, `${control.what} is not the hit target at its centre: ${detail}`).toBe(true);
    });

    if (config.distance) {
      it("Edit row bottom → first diff code line top ≤ 40px", () => {
        expect(m.found && m.firstCodeLine !== null, `no meta line → diff; opened detail: ${m.detail}`).toBe(true);
        // The one thing allowed above the meta line is the Input zone's label line (IO zones).
        expect(m.zoneLabel, `the diff sits in a zone: ${JSON.stringify(m.zoneLabel)}`).not.toBeNull();
        expect(m.zoneLabel.kind, "the diff is the recorded change: Input").toBe("input");
        expect(m.zoneLabel.labelLine, "the zone starts with its label line").toBe(true);
        const gap = m.firstCodeLine.top - m.row.bottom - m.zoneLabel.span;
        expect(gap, JSON.stringify({ gap, zoneLabelSpan: m.zoneLabel.span, row: m.row, meta: m.meta, firstCodeLine: m.firstCodeLine })).toBeLessThanOrEqual(40);
        expect(m.zoneLabel.span, "the label line is one caption line, not a block").toBeLessThanOrEqual(28);
        expect(m.metaLines, `meta line wraps at 1440 en: ${m.metaText}`).toBe(1);
      });
    }

    if (config.phone) {
      it("the row's path stays on one line and the meta line is one line (no chip row)", () => {
        expect(m.found, `no meta line; opened detail: ${m.detail}`).toBe(true);
        expect(m.pathLines, `path "${m.pathText}" wraps`).toBe(1);
        expect(m.metaLines, `meta line "${m.metaText}" wraps`).toBe(1);
      });
    }
  });
});
