// A card header's right-hand group stays inside its card (TR0b review
// round 1, F1).
//
// Real WebKit, the real server, raw Claude records. TR0b put the shared
// OutcomeStatus ("No result recorded", "Failed · url_not_accessible") into
// the right-hand groups of six cards beside their badges and the copy-ID
// button. RendererHeader gave that group a `shrink-0` box with no width cap
// and the groups were non-wrapping rows, so on a phone the Agent header
// (general-purpose + background + status + copy button) ran past the card:
// the card clips its overflow, so the status lost its end and the copy
// button left the card. The page itself never overflows, so a page-overflow
// check cannot see this.
//
// Planted into the generated "unknown-outcome" session (fixture copy owned
// by this file): Agent general-purpose + background with no result, an
// `error_code` result and a plain result; an MCP tool (DefaultCard) and an
// AskUserQuestion with a failed / missing result; Workflow with a name and a
// failed result and with a run id; WebFetch (single-item group) with an
// `error_code`. For every header, at 390x844 en, 390x844 ko at font scale
// 125% and 1180x760 en (positive control, fits on head before the fix):
// every visible child of the right group lies inside the card's content box,
// so does every line box of the status text (error code included), the
// status is not ellipsised, and the copy button is the element hit at its
// centre. Skipped without WebKit or a built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { settle } from "../lib/browser.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, innerWidth */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "cardHeaderFit.test" }).enabled;

const AGENT_INPUT = {
  description: "Audit the release notes",
  prompt: "Check every link in CHANGELOG.md",
  subagent_type: "general-purpose",
  run_in_background: true,
};
const ASK_INPUT = {
  questions: [{ question: "Which store?", header: "Storage", multiSelect: false, options: [{ label: "SQLite" }, { label: "PostgreSQL" }] }],
};

/**
 * One planted call per case. `result`: absent = no result record; else the
 * tool_result block's content, `meta` its record's `toolUseResult`.
 * `copy`: the header has the copy-ID button. `status`: the header shows an
 * OutcomeStatus. `anchor`: text that finds a header without a copy button.
 */
const CASES = [
  { id: "toolu_fit_agent_none", name: "Agent", input: AGENT_INPUT, copy: true, status: true },
  { id: "toolu_fit_agent_error_code", name: "Agent", input: AGENT_INPUT, result: "Fetch failed", meta: { error_code: "url_not_accessible" }, copy: true, status: true },
  { id: "toolu_fit_agent_plain", name: "Agent", input: AGENT_INPUT, result: "All 14 links resolve.", copy: true, status: false },
  { id: "toolu_fit_mcp_error_code", name: "mcp__kiln__deploy_preview", input: { branch: "release/2.4" }, result: "Preview failed", meta: { error_code: "url_not_accessible" }, copy: true, status: true },
  { id: "toolu_fit_ask_none", name: "AskUserQuestion", input: ASK_INPUT, copy: true, status: true },
  {
    id: "toolu_fit_workflow_error_code",
    name: "Workflow",
    input: { description: "Publish the docs", script: 'export const meta = { name: "publish-docs-site" };' },
    result: "Publish failed",
    meta: { error_code: "url_not_accessible" },
    anchor: "publish-docs-site",
    copy: false,
    status: true,
  },
  {
    id: "toolu_fit_workflow_run",
    name: "Workflow",
    input: { description: "Rebuild the index", script: 'export const meta = { name: "rebuild-search-index" };' },
    result: "Started. Transcript dir: /tmp/kiln/subagents/workflows/wf_5c2e81d0-9ab",
    anchor: "rebuild-search-index",
    copy: false,
    status: false,
  },
  { id: "toolu_fit_webfetch_error_code", name: "WebFetch", input: { url: "https://status.example.com/api/v2/health", prompt: "Is it up?" }, result: "unreachable", meta: { error_code: "url_not_accessible" }, anchor: "WebFetch", copy: false, status: true },
];

const CONFIGS = [
  { label: "390x844 en", scenario: "transcript-unknown-outcome--390x844--dark", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125%", scenario: "transcript-unknown-outcome--390x844--dark", locale: "ko", variant: { fontScale: 1.25 } },
  { label: "1180x760 en (positive control)", scenario: "transcript-unknown-outcome--1180x760--dark", locale: "en", variant: {} },
];

let app;
let browser;

/** The unknown-outcome session becomes: the user's question, one assistant turn with every case, their results. */
function plantCases(fixture) {
  const project = fixture.projects.find((p) => p.name === "kiln-renderers");
  const session = project.sessions.find((s) => s.title === fixture.namedSessions["unknown-outcome"].title);
  const old = fs
    .readFileSync(session.filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const question = old.find((r) => r.type === "user" && typeof r.message?.content === "string");
  const assistant = structuredClone(old.find((r) => r.type === "assistant" && r.message.content.some((b) => b.type === "tool_use")));
  const resultTemplate = old.find((r) => r.type === "user" && Object.hasOwn(r, "toolUseResult"));
  assistant.message.content = [
    { type: "text", text: "Checking the release in parallel." },
    ...CASES.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
  ];
  const records = [question, assistant];
  CASES.forEach((c, i) => {
    if (c.result === undefined) return;
    const record = {
      ...structuredClone(resultTemplate),
      uuid: `fit-result-${i}`,
      parentUuid: assistant.uuid,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: c.id, content: c.result }] },
    };
    delete record.toolUseResult;
    if (c.meta) record.toolUseResult = c.meta;
    records.push(record);
  });
  fs.writeFileSync(session.filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("card-header-fit");
  plantCases(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Find the case's card (Renderer frame) and mark it; `null` if absent. */
const markCard = (page, c) =>
  page.evaluate(({ id, anchor }) => {
    const isFrame = (el) => el.classList.contains("overflow-hidden") && el.classList.contains("border");
    let start = null;
    if (anchor) {
      start = [...document.querySelectorAll("[data-message-uuid] span, [data-message-uuid] code")].find((el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue ?? "").trim().startsWith(anchor)),
      );
    } else {
      start = [...document.querySelectorAll("[data-message-uuid] button[aria-label]")].find((b) => b.getAttribute("aria-label").endsWith(id));
    }
    let card = start;
    while (card && !isFrame(card)) card = card.parentElement;
    if (!card) return null;
    document.querySelectorAll("[data-fit-card]").forEach((el) => el.removeAttribute("data-fit-card"));
    card.setAttribute("data-fit-card", id);
    card.scrollIntoView({ block: "center" });
    return true;
  }, c);

/** Geometry of the marked card's header, right group, status and copy button. */
const headerGeometry = (page) =>
  page.evaluate(() => {
    const card = document.querySelector("[data-fit-card]");
    const box = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const inner = {
      left: box.left + parseFloat(cs.borderLeftWidth),
      right: box.right - parseFloat(cs.borderRightWidth),
      top: box.top + parseFloat(cs.borderTopWidth),
      bottom: box.bottom - parseFloat(cs.borderBottomWidth),
    };
    const header = card.firstElementChild;
    const right = header.lastElementChild;
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) });
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    // The group's items: the right wrapper's own children, or the children of
    // the one inner row a card puts there.
    const group = right.children.length === 1 && right.firstElementChild.children.length > 0 && !right.firstElementChild.querySelector(":scope > svg")
      ? right.firstElementChild
      : right;
    const children = [...group.children].filter(visible).map((el) => ({
      tag: el.tagName,
      text: (el.textContent ?? "").trim(),
      rect: rect(el.getBoundingClientRect()),
    }));
    const icon = card.querySelector("[data-outcome-icon]");
    let status = null;
    if (icon) {
      const span = icon.parentElement;
      const range = document.createRange();
      range.selectNodeContents(span);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0).map(rect);
      let ellipsis = false;
      for (let el = span; el && el !== card; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) ellipsis = true;
      }
      status = { text: span.textContent, lines, ellipsis, scrollWidth: span.scrollWidth, clientWidth: span.clientWidth };
    }
    const button = header.querySelector("button[aria-label]:not([aria-expanded])");
    let copy = null;
    if (button) {
      const r = button.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const hit = document.elementFromPoint(cx, cy);
      copy = { rect: rect(r), hitIsButton: !!hit && (hit === button || button.contains(hit)), hit: hit ? `${hit.tagName}.${hit.getAttribute("class") ?? ""}` : null };
    }
    return { viewport: innerWidth, card: rect(inner), header: (header.innerText ?? "").replace(/\s+/g, " "), children, status, copy };
  });

const inside = (r, box) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;

describe.skipIf(!ENABLED)("card header right groups stay inside the card (real WebKit, raw Claude records)", () => {
  describe.each(CONFIGS)("$label", (config) => {
    const measured = new Map();
    let session;

    beforeAll(async () => {
      session = await openScenario(browser, app, config.scenario, { locale: config.locale, variant: config.variant });
      for (const c of CASES) {
        const found = await markCard(session.page, c);
        if (!found) {
          measured.set(c.id, null);
          continue;
        }
        await settle(session, { label: `fit ${c.id}` });
        // The list may re-render on scroll: mark again, then measure.
        await markCard(session.page, c);
        measured.set(c.id, await headerGeometry(session.page));
      }
    }, 240_000);

    afterAll(async () => {
      await session?.close();
    });

    it.each(CASES.map((c) => [c.id, c]))("%s: right group, status and copy button inside the card", (_id, c) => {
      const g = measured.get(c.id);
      expect(g, `card for ${c.id} not found in the transcript`).toBeTruthy();
      const detail = JSON.stringify(g);
      expect(g.children.length, `empty right group: ${detail}`).toBeGreaterThan(0);
      for (const child of g.children) {
        expect(inside(child.rect, g.card), `right-group child <${child.tag}> "${child.text}" leaves the card: ${detail}`).toBe(true);
      }
      if (c.status) {
        expect(g.status, `no status shown: ${detail}`).not.toBeNull();
        expect(g.status.lines.length, detail).toBeGreaterThan(0);
        for (const line of g.status.lines) {
          expect(inside(line, g.card), `status text "${g.status.text}" clipped by the card: ${detail}`).toBe(true);
        }
        expect(g.status.ellipsis, `status ellipsised: ${detail}`).toBe(false);
        expect(g.status.scrollWidth, `status wider than its box: ${detail}`).toBeLessThanOrEqual(g.status.clientWidth + 1);
      } else {
        expect(g.status, `unexpected status: ${detail}`).toBeNull();
      }
      if (c.copy) {
        expect(g.copy, `no copy button: ${detail}`).not.toBeNull();
        expect(inside(g.copy.rect, g.card), `copy button outside the card: ${detail}`).toBe(true);
        expect(g.copy.hitIsButton, `copy button is not the hit target at its centre: ${detail}`).toBe(true);
      }
    });
  });
});
