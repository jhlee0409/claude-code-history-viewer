// Input / Result zones in real WebKit (owner option B, 2026-10-25).
//
// The opened rows of three harness scenarios — `transcript-failure-open`
// (the failed build with its danger stderr, the interrupted run, the call
// with no result), `transcript-webfetch-open` (the failed fetch with only an
// error code, the successful one) and `transcript-agent-open` (the Task
// that spawned a subagent) — at 1440x900 en, 390x844 en and 390x844 ko at
// font scale 125 %. For every opened row:
// - its zones, in order (input → result; a zone only with content);
// - each label shows its locale's word, every glyph line box lies inside
//   the label's own box, the row box and the viewport (unclipped), and it is
//   not ellipsised;
// - the input zone's rule is a solid 1px left border inside the row box, of
//   a different computed colour and width than OutputBlock's stderr rules
//   (the real failed stderr zone in `transcript-failure-open`, and the
//   neutral `border-l-2 border-line` class pair probed in the same page);
// - at rest, no label and no input rule overlaps the floating scroll
//   buttons.
// Probes wait with the harness `settle()` (the page clock is paused).
// Skipped without WebKit or a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { settle } from "../lib/browser.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, innerWidth, innerHeight */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "detailZones.test" }).enabled;

const SCENARIOS = [
  {
    screen: "transcript-failure-open",
    rows: [
      { anchor: "pnpm build", kinds: ["input", "result"], stderr: true },
      { anchor: "pnpm e2e", kinds: ["input", "result"] },
      { anchor: "pnpm release", kinds: ["input"] },
    ],
  },
  {
    screen: "transcript-webfetch-open",
    rows: [
      { anchor: "status.example.com/api", kinds: ["input"] },
      { anchor: "example.com/changelog", kinds: ["input", "result"] },
    ],
  },
  {
    screen: "transcript-agent-open",
    rows: [{ anchor: "Audit the production bundle", kinds: ["input", "result"] }],
  },
];

const CONFIGS = [
  { label: "1440x900 en", size: "1440x900", locale: "en", variant: {} },
  { label: "390x844 en", size: "390x844", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125%", size: "390x844", locale: "ko", variant: { fontScale: 1.25 } },
];

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("detail-zones");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Centre the opened row whose head holds `anchor`; `false` when it is not there. */
const centreRow = (page, anchor) =>
  page.evaluate((text) => {
    const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes(text));
    const wrapper = row?.closest("[data-tool-row-wrapper]");
    if (!wrapper) return false;
    wrapper.scrollIntoView({ block: "center" });
    return true;
  }, anchor);

/** Geometry of the row's zones, its stderr rule, the neutral stderr probe and the floating buttons. */
const measure = (page, anchor) =>
  page.evaluate((text) => {
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) });
    const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes(text));
    const wrapper = row?.closest("[data-tool-row-wrapper]");
    if (!wrapper) return null;
    const detail = wrapper.querySelector("[data-tool-detail]:not([hidden])");
    const zones = [...(detail?.querySelectorAll("[data-detail-zone]") ?? [])].map((zone) => {
      const labelId = zone.getAttribute("aria-labelledby");
      const label = labelId ? document.getElementById(labelId) : null;
      const s = getComputedStyle(zone);
      let lines = [];
      let ellipsis = false;
      if (label) {
        const range = document.createRange();
        range.selectNodeContents(label);
        lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0).map(rect);
        for (let el = label; el && el !== wrapper; el = el.parentElement) {
          const ls = getComputedStyle(el);
          if (ls.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) ellipsis = true;
        }
      }
      const z = zone.getBoundingClientRect();
      const ruleWidth = parseFloat(s.borderLeftWidth) || 0;
      return {
        kind: zone.getAttribute("data-detail-zone"),
        tag: zone.tagName,
        label: label ? { text: (label.textContent ?? "").trim(), rect: rect(label.getBoundingClientRect()), lines, ellipsis, userSelect: getComputedStyle(label).webkitUserSelect || getComputedStyle(label).userSelect } : null,
        box: rect(z),
        rule: { width: s.borderLeftWidth, style: s.borderLeftStyle, color: s.borderLeftColor, background: s.backgroundColor, rect: rect({ left: z.left, right: z.left + ruleWidth, top: z.top, bottom: z.bottom }) },
      };
    });
    const stderrEl = detail?.querySelector("[data-stderr]");
    const stderr = stderrEl ? { width: getComputedStyle(stderrEl).borderLeftWidth, color: getComputedStyle(stderrEl).borderLeftColor } : null;
    const probe = document.createElement("div");
    probe.className = "border-l-2 border-line";
    detail?.appendChild(probe);
    const neutral = { width: getComputedStyle(probe).borderLeftWidth, color: getComputedStyle(probe).borderLeftColor };
    probe.remove();
    const buttons = [...document.querySelectorAll("[data-testid='message-scroll-buttons'] button")].map((b) => rect(b.getBoundingClientRect()));
    return { viewport: { width: innerWidth, height: innerHeight }, box: rect(wrapper.getBoundingClientRect()), zones, stderr, neutral, buttons };
  }, anchor);

const inside = (r, box) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe.skipIf(!ENABLED)("detail zones: labelled input / result, the input rule (real WebKit)", () => {
  describe.each(CONFIGS)("$label", (config) => {
    describe.each(SCENARIOS)("$screen", (scenario) => {
      const measured = new Map();
      let session;

      beforeAll(async () => {
        session = await openScenario(browser, app, `${scenario.screen}--${config.size}--dark`, { locale: config.locale, variant: config.variant });
        for (const row of scenario.rows) {
          if (!(await centreRow(session.page, row.anchor))) {
            measured.set(row.anchor, null);
            continue;
          }
          await settle(session, { label: `zones ${row.anchor}` });
          await centreRow(session.page, row.anchor);
          await settle(session, { label: `zones ${row.anchor} centred` });
          measured.set(row.anchor, await measure(session.page, row.anchor));
        }
      }, 240_000);

      afterAll(async () => {
        await session?.close();
      });

      it.each(scenario.rows.map((r) => [r.anchor, r]))("%s", (_anchor, row) => {
        const m = measured.get(row.anchor);
        expect(m, `opened row "${row.anchor}" not found`).toBeTruthy();
        const detail = JSON.stringify(m);
        expect(m.zones.map((z) => z.kind), `zones in order: ${detail}`).toEqual(row.kinds);
        const words = { input: session.t("toolRow.inputZone"), result: session.t("toolRow.resultZone") };
        for (const z of m.zones) {
          expect(z.tag, "a <section> region").toBe("SECTION");
          expect(z.label, `zone without its label: ${detail}`).not.toBeNull();
          expect(z.label.text).toBe(words[z.kind]);
          expect(z.label.lines.length, `label not visible: ${detail}`).toBeGreaterThan(0);
          for (const line of z.label.lines) {
            expect(inside(line, z.label.rect), `label glyphs leave the label box: ${detail}`).toBe(true);
            expect(inside(line, m.box), `label glyphs leave the row: ${detail}`).toBe(true);
            expect(inside(line, { left: 0, top: 0, right: m.viewport.width, bottom: m.viewport.height }), `label off screen: ${detail}`).toBe(true);
            for (const b of m.buttons) expect(overlaps(line, b), `label under a floating button: ${detail}`).toBe(false);
          }
          expect(z.label.ellipsis, `label ellipsised: ${detail}`).toBe(false);
          expect(z.label.userSelect, "the label is not selected with the content").toBe("none");
          expect(inside(z.box, m.box), `zone leaves the row box: ${detail}`).toBe(true);
          if (z.kind === "input") {
            expect(z.rule.style, `input rule: ${detail}`).toBe("solid");
            expect(z.rule.width, `input rule is 1px: ${detail}`).toBe("1px");
            expect(inside(z.rule.rect, m.box), `input rule leaves the row: ${detail}`).toBe(true);
            for (const b of m.buttons) expect(overlaps(z.rule.rect, b), `input rule under a floating button: ${detail}`).toBe(false);
            expect(z.rule.color, "the input rule is not the neutral stderr rule's colour").not.toBe(m.neutral.color);
            expect(z.rule.width, "nor its width").not.toBe(m.neutral.width);
            if (m.stderr) {
              expect(z.rule.color, "the input rule is not the failed stderr rule's colour").not.toBe(m.stderr.color);
              expect(z.rule.width, "nor its width").not.toBe(m.stderr.width);
            }
          } else {
            expect(z.rule.width, `the result zone has no rule: ${detail}`).toBe("0px");
          }
        }
        if (row.stderr) expect(m.stderr, `the failed build shows its stderr zone: ${detail}`).not.toBeNull();
      });
    });
  });
});
