// Owner-approved signals #12 and #14 in real WebKit (owner decision 2026-10-25).
//
// #12: every opened tool row's detail ends with a 1px solid hairline in the
// faint line token (the computed colour of `border-line-faint` in the same
// page and theme), with 8px inside it and 8px after it; only the bottom edge
// (not a frame), after the detail's meta line, inside the row box. A closed
// row has no line and no extra height (its wrapper is exactly its head).
// Where two opened rows meet, exactly one horizontal line lies between the
// first row's content and the second row's head.
//
// #14: each row icon's native tooltip (`title`) and accessible name
// (`role="img"` + `aria-label`) are the translated tool kind; the button's
// accessibility snapshot names the image by the kind and still holds the
// verb and the target; the icon never takes keyboard focus (Tab from a row
// button goes to the row's own detail controls or the next row, never to
// the icon).
//
// Scenarios: `transcript-failure-open` (three opened Bash rows with other
// rows closed) and `transcript-run-open` (the Read·Grep run, every row
// opened: adjacent opened rows), at 1440x900 en (dark and light) and 390x844
// ko at font scale 125 % (dark). Probes wait with the harness `settle()`.
// Skipped without WebKit or a built server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { settle } from "../lib/browser.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "ioSignals.test" }).enabled;

const KIND_KEY = {
  Bash: "toolRow.kindTerminal",
  Read: "toolRow.kindFileRead",
  Write: "toolRow.kindFileWrite",
  Edit: "toolRow.kindFileEdit",
  MultiEdit: "toolRow.kindFileEdit",
  Grep: "toolRow.kindContentSearch",
  Glob: "toolRow.kindFileSearch",
  WebSearch: "toolRow.kindWebSearch",
  WebFetch: "toolRow.kindWebFetch",
  Task: "toolRow.kindAgent",
  Agent: "toolRow.kindAgent",
};
/** A recorded name the shared map does not list: the generic kind. */
/** The locale's word for `key`, or null when the locale lacks it (the harness translator throws). */
const word = (session, key) => {
  try {
    return session.t(key);
  } catch {
    return null;
  }
};
const kindKeyOf = (verb) => (Object.hasOwn(KIND_KEY, verb) ? KIND_KEY[verb] : "toolRow.kindGeneric");

const SCENARIOS = [
  { screen: "transcript-failure-open", minOpened: 3, adjacentPairs: false },
  { screen: "transcript-run-open", minOpened: 2, adjacentPairs: true },
];

const CONFIGS = [
  { label: "1440x900 en dark", size: "1440x900", theme: "dark", locale: "en", variant: {} },
  { label: "1440x900 en light", size: "1440x900", theme: "light", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125% dark", size: "390x844", theme: "dark", locale: "ko", variant: { fontScale: 1.25 } },
];

let app;
let browser;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("io-signals");
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Every rendered transcript tool row: its head, detail, icon and the line geometry. */
const measureRows = (page) =>
  page.evaluate(() => {
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), height: +r.height.toFixed(2) });
    const probe = document.createElement("div");
    probe.className = "border-b border-line-faint";
    document.querySelector("[data-message-uuid]")?.appendChild(probe);
    const faint = getComputedStyle(probe).borderBottomColor;
    probe.remove();
    const wrappers = [...document.querySelectorAll("[data-message-uuid] [data-tool-row-wrapper]")];
    const rows = wrappers.map((wrapper, index) => {
      const head = wrapper.querySelector(":scope > [data-tool-row]");
      const button = head?.querySelector("button[aria-expanded]");
      const detail = wrapper.querySelector(":scope > [data-tool-detail]");
      const icon = head?.querySelector("[data-tool-icon]");
      const ds = detail ? getComputedStyle(detail) : null;
      const meta = detail?.querySelector(":scope > [data-meta]");
      return {
        index,
        verb: (head?.querySelector("[data-tool-verb]")?.textContent ?? "").trim(),
        open: button?.getAttribute("aria-expanded") === "true",
        wrapper: rect(wrapper.getBoundingClientRect()),
        head: head ? rect(head.getBoundingClientRect()) : null,
        detail: detail ? rect(detail.getBoundingClientRect()) : null,
        meta: meta ? rect(meta.getBoundingClientRect()) : null,
        style: ds
          ? {
              display: ds.display,
              bottom: { width: ds.borderBottomWidth, style: ds.borderBottomStyle, color: ds.borderBottomColor },
              top: ds.borderTopWidth,
              left: ds.borderLeftWidth,
              right: ds.borderRightWidth,
              paddingBottom: ds.paddingBottom,
              marginBottom: ds.marginBottom,
            }
          : null,
        icon: icon ? { title: icon.getAttribute("title"), label: icon.getAttribute("aria-label"), role: icon.getAttribute("role"), tabIndex: icon.tabIndex, innerTitles: [...icon.querySelectorAll("[title]")].map((el) => el.getAttribute("title")) } : null,
        // Adjacent: the next wrapper follows this one with no other rendered block in between.
        nextIsRow: (() => {
          const next = wrappers[index + 1];
          if (!next) return false;
          const range = document.createRange();
          range.setStartAfter(wrapper);
          range.setEndBefore(next);
          return (range.toString() ?? "").trim() === "";
        })(),
      };
    });
    // Every horizontal border edge in the transcript (for "one line where two opened rows meet").
    const edges = [];
    for (const el of document.querySelectorAll("[data-message-uuid] *")) {
      const s = getComputedStyle(el);
      if (s.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40) continue;
      if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none") edges.push({ y: +r.top.toFixed(2), left: r.left, right: r.right });
      if (parseFloat(s.borderBottomWidth) > 0 && s.borderBottomStyle !== "none") edges.push({ y: +(r.bottom - parseFloat(s.borderBottomWidth)).toFixed(2), left: r.left, right: r.right });
    }
    return { faint, rows, edges };
  });

describe.skipIf(!ENABLED)("signals #12 (hairline after an opened detail) and #14 (kind on the row icon), real WebKit", () => {
  describe.each(CONFIGS)("$label", (config) => {
    describe.each(SCENARIOS)("$screen", (scenario) => {
      let session;
      let m;
      let tabs = [];

      beforeAll(async () => {
        session = await openScenario(browser, app, `${scenario.screen}--${config.size}--${config.theme}`, { locale: config.locale, variant: config.variant });
        m = await measureRows(session.page);
        // Keyboard: from each of the first opened and the first closed row button, one Tab (Alt+Tab in WebKit).
        for (const wantOpen of [true, false]) {
          const index = m.rows.findIndex((r) => r.open === wantOpen);
          if (index < 0) continue;
          const ok = await session.page.evaluate(
            (i) => {
              const button = document.querySelectorAll("[data-message-uuid] [data-tool-row-wrapper]")[i]?.querySelector("[data-tool-row] button[aria-expanded]");
              button?.focus();
              return document.activeElement === button;
            },
            index,
          );
          await session.page.keyboard.press("Alt+Tab");
          await settle(session, { label: `tab from row ${index}` });
          const landed = await session.page.evaluate((i) => {
            const wrapper = document.querySelectorAll("[data-message-uuid] [data-tool-row-wrapper]")[i];
            const a = document.activeElement;
            return {
              onIcon: !!a?.closest("[data-tool-icon]"),
              inOwnDetail: !!wrapper?.querySelector("[data-tool-detail]")?.contains(a),
              text: (a?.textContent ?? "").trim().slice(0, 60),
              tag: a?.tagName,
            };
          }, index);
          tabs.push({ index, open: wantOpen, focused: ok, landed });
        }
      }, 240_000);

      afterAll(async () => {
        await session?.close();
      });

      it("#12 every opened detail ends with one 1px faint hairline (8px inside, 8px after), after its meta line; not a frame", () => {
        const opened = m.rows.filter((r) => r.open);
        expect(opened.length, `opened rows: ${JSON.stringify(m.rows.map((r) => [r.verb, r.open]))}`).toBeGreaterThanOrEqual(scenario.minOpened);
        for (const r of opened) {
          const detail = JSON.stringify(r);
          expect(r.style.bottom, `hairline: ${detail}`).toEqual({ width: "1px", style: "solid", color: m.faint });
          expect([r.style.top, r.style.left, r.style.right], `only the bottom edge: ${detail}`).toEqual(["0px", "0px", "0px"]);
          expect(r.style.paddingBottom, `8px inside the line: ${detail}`).toBe("8px");
          expect(r.style.marginBottom, `8px after the line: ${detail}`).toBe("8px");
          if (r.meta) expect(r.meta.bottom, `the line comes after the meta line: ${detail}`).toBeLessThanOrEqual(r.detail.bottom - 1 - 8 + 0.5);
          expect(r.detail.bottom, `the line sits inside the row box: ${detail}`).toBeLessThanOrEqual(r.wrapper.bottom + 0.5);
          expect(r.detail.left, `inside the row box: ${detail}`).toBeGreaterThanOrEqual(r.wrapper.left - 0.5);
          expect(r.detail.right, `inside the row box: ${detail}`).toBeLessThanOrEqual(r.wrapper.right + 0.5);
        }
      });

      it("#12 a closed row has no line and no extra height", () => {
        for (const r of m.rows.filter((row) => !row.open)) {
          const detail = JSON.stringify(r);
          expect(r.style.display, `closed detail is not rendered: ${detail}`).toBe("none");
          expect(Math.abs(r.wrapper.height - r.head.height), `the closed row is just its head: ${detail}`).toBeLessThanOrEqual(0.5);
        }
      });

      it("#12 where two opened rows meet, one line lies between them", () => {
        const pairs = [];
        for (let i = 0; i + 1 < m.rows.length; i++) {
          const a = m.rows[i];
          const b = m.rows[i + 1];
          if (!a.open || !b.open || !a.nextIsRow) continue;
          const from = a.meta ? a.meta.bottom : a.head.bottom;
          const lines = m.edges.filter((e) => e.y >= from - 0.5 && e.y <= b.head.top + 0.5 && e.left < b.head.right && e.right > b.head.left);
          pairs.push({ a: a.index, b: b.index, lines: lines.length });
        }
        if (scenario.adjacentPairs) expect(pairs.length, "the run has adjacent opened rows").toBeGreaterThan(0);
        for (const p of pairs) expect(p.lines, `rows ${p.a} → ${p.b}: ${JSON.stringify(pairs)}`).toBe(1);
      });

      it("#14 every row icon's tooltip and accessible name are the translated kind (no inner tooltip)", () => {
        expect(m.rows.length).toBeGreaterThan(0);
        for (const r of m.rows) {
          const detail = JSON.stringify(r);
          const key = kindKeyOf(r.verb);
          const kind = word(session, key);
          expect(r.icon?.title ?? null, `the icon's tooltip: ${detail}`).not.toBeNull();
          expect(kind, `the locale has ${key}`).toBeTruthy();
          expect(r.icon, `the icon: ${detail}`).toEqual({ title: kind, label: kind, role: "img", tabIndex: -1, innerTitles: [] });
        }
      });

      it("#14 the row button's accessibility tree names the icon by the kind and keeps the verb and target", async () => {
        const first = m.rows.find((r) => r.open) ?? m.rows[0];
        const kind = word(session, kindKeyOf(first.verb));
        expect(kind, `the locale has ${kindKeyOf(first.verb)}`).toBeTruthy();
        const snapshot = await session.page
          .locator("[data-message-uuid] [data-tool-row-wrapper]")
          .nth(first.index)
          .locator("[data-tool-row] button[aria-expanded]")
          .ariaSnapshot();
        expect(snapshot, snapshot).toContain(`img "${kind}"`);
        expect(snapshot, snapshot).toContain(first.verb);
        const buttonLine = snapshot.split("\n")[0];
        expect(buttonLine, snapshot).toMatch(new RegExp(`^- button "${kind} ${first.verb} \\S`));
      });

      it("#14 the icon is never a Tab stop", () => {
        expect(tabs.length).toBeGreaterThan(0);
        for (const tab of tabs) {
          const detail = JSON.stringify(tab);
          expect(tab.focused, `the row button took focus: ${detail}`).toBe(true);
          expect(tab.landed.onIcon, `Tab landed on the icon: ${detail}`).toBe(false);
          if (tab.open) expect(tab.landed.inOwnDetail, `from an opened row, Tab goes into its own detail: ${detail}`).toBe(true);
        }
      });
    });
  });
});
