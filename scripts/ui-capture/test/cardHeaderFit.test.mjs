// A tool row's head and its opened detail stay inside the row (TR0b review
// round 1, F1; migrated to ToolRow by TR1a).
//
// Real WebKit, the real server, raw Claude records. TR0b put the shared
// OutcomeStatus ("No result recorded", "Failed · url_not_accessible") into
// the card headers beside their badges and the copy-ID button, and on a
// phone the Agent header (general-purpose + background + status + copy)
// ran past its card. TR1a turned the six cards into ToolRows: no frame, the
// head is icon · recorded tool name · target · caption meta · status, and
// the copy control ends the opened detail's meta line. The box every piece
// must stay inside is the row wrapper (`[data-tool-row-wrapper]`); the page
// itself never overflows, so a page-overflow check cannot see a clip.
//
// Planted into the generated "unknown-outcome" session (fixture copy owned
// by this file), the widest combination per card: Agent with
// general-purpose + background and no result / an `error_code` / a plain
// result; Default with a long MCP name and an `error_code`; AskUserQuestion
// with no result; Workflow with a long name and a failed result, and one
// with a run id; WebFetch failed with an error code and a long URL. For
// every row, at 390x844 en, 390x844 ko at font scale 125% and 1180x760 en:
// every visible piece of the head (verb, target, meta, status) lies inside
// the row box, the target keeps room (> 40px: a right group that does not
// fit moves under the head instead of squeezing it to nothing), the verb is
// the recorded name (its title keeps it whole when a long MCP name is cut),
// the status is whole (not ellipsised, every line box inside),
// the row opens, and its "Copy tool ID" lies inside the row box and is the
// element hit at its centre. Plus the real `transcript-failure` session: its
// `url_not_accessible` WebFetch row says "Failed · url_not_accessible".
// Probes wait with the harness `settle()` (the page clock is paused).
// Skipped without WebKit or a built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, innerWidth */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "cardHeaderFit.test" }).enabled;

const agentInput = (description) => ({
  description,
  prompt: "Check every link in CHANGELOG.md",
  subagent_type: "general-purpose",
  run_in_background: true,
});
const ASK_INPUT = {
  questions: [{ question: "Which store should the release keep?", header: "Storage", multiSelect: false, options: [{ label: "SQLite" }, { label: "PostgreSQL" }] }],
};
const LONG_MCP = "mcp__kiln_production_deploy__deploy_preview_environment_for_branch";

/**
 * One planted call per case. `result`: absent = no result record; else the
 * tool_result block's content, `meta` its record's `toolUseResult`.
 * `anchor`: text of the row that finds it (its target). `status`: the
 * OutcomeStatus the row shows ("noResult", "failedCode" =
 * "Failed · url_not_accessible", in the page's locale; null: quiet).
 */
const CASES = [
  { id: "toolu_fit_agent_none", name: "Agent", input: agentInput("Audit the release notes (none)"), anchor: "Audit the release notes (none)", status: "noResult" },
  { id: "toolu_fit_agent_error_code", name: "Agent", input: agentInput("Audit the release notes (failed)"), result: "Fetch failed", meta: { error_code: "url_not_accessible" }, anchor: "Audit the release notes (failed)", status: "failedCode" },
  { id: "toolu_fit_agent_plain", name: "Agent", input: agentInput("Audit the release notes (done)"), result: "All 14 links resolve.", anchor: "Audit the release notes (done)", status: null },
  { id: "toolu_fit_mcp_error_code", name: LONG_MCP, input: { description: "Deploy release/2.4-preview-environment", branch: "release/2.4" }, result: "Preview failed", meta: { error_code: "url_not_accessible" }, anchor: "Deploy release/2.4-preview-environment", status: "failedCode" },
  { id: "toolu_fit_ask_none", name: "AskUserQuestion", input: ASK_INPUT, anchor: "Which store should the release keep?", status: "noResult" },
  {
    id: "toolu_fit_workflow_error_code",
    name: "Workflow",
    input: { description: "Publish the docs", script: 'export const meta = { name: "publish-docs-site-to-the-production-bucket" };' },
    result: "Publish failed",
    meta: { error_code: "url_not_accessible" },
    anchor: "publish-docs-site-to-the-production-bucket",
    status: "failedCode",
  },
  {
    id: "toolu_fit_workflow_run",
    name: "Workflow",
    input: { description: "Rebuild the index", script: 'export const meta = { name: "rebuild-search-index" };' },
    result: "Started. Transcript dir: /tmp/kiln/subagents/workflows/wf_5c2e81d0-9ab",
    anchor: "rebuild-search-index",
    status: null,
  },
  {
    id: "toolu_fit_webfetch_error_code",
    name: "WebFetch",
    input: { url: "https://status.example.com/api/v2/health/components/release-pipeline", prompt: "Is it up?" },
    result: [{ type: "text", text: '{"error_code":"url_not_accessible"}' }],
    meta: { error_code: "url_not_accessible" },
    anchor: "status.example.com/api/v2/health",
    status: "failedCode",
  },
];

const CONFIGS = [
  { label: "390x844 en", scenario: "transcript-unknown-outcome--390x844--dark", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125%", scenario: "transcript-unknown-outcome--390x844--dark", locale: "ko", variant: { fontScale: 1.25 } },
  { label: "1180x760 en", scenario: "transcript-unknown-outcome--1180x760--dark", locale: "en", variant: {} },
];

const SCENARIOS = new Map(expandScenarios().map((s) => [s.id, s]));

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

/** Find the case's row by its anchor text, mark its wrapper and centre it; `false` if absent. */
const markRow = (page, anchor) =>
  page.evaluate((text) => {
    const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes(text));
    const wrapper = row?.closest("[data-tool-row-wrapper]");
    if (!wrapper) return false;
    document.querySelectorAll("[data-fit-row]").forEach((el) => el.removeAttribute("data-fit-row"));
    wrapper.setAttribute("data-fit-row", "");
    wrapper.scrollIntoView({ block: "center" });
    return true;
  }, anchor);

/** Geometry of the marked row: its box, every head piece, the status, and (opened) the copy control. */
const rowGeometry = (page) =>
  page.evaluate(() => {
    const wrapper = document.querySelector("[data-fit-row]");
    const row = wrapper.querySelector("[data-tool-row]");
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) });
    const box = rect(wrapper.getBoundingClientRect());
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    // Head pieces: the disclosure's children (chevron, icon, verb, target) and the right group's children.
    const button = row.querySelector("button[aria-expanded]");
    const right = row.lastElementChild;
    const pieces = [...button.children, ...right.querySelectorAll(":scope > *, :scope > * > *")]
      .filter(visible)
      .map((el) => ({ tag: el.tagName, text: (el.textContent ?? "").trim().slice(0, 60), rect: rect(el.getBoundingClientRect()) }));
    // The verb: its box, whether its ellipsis cuts it (a long MCP name), and the name its title keeps.
    const verbEl = row.querySelector("[data-tool-verb]");
    const verb = verbEl
      ? { text: verbEl.textContent, title: verbEl.getAttribute("title"), rect: rect(verbEl.getBoundingClientRect()), cut: getComputedStyle(verbEl).textOverflow === "ellipsis" && verbEl.scrollWidth > verbEl.clientWidth + 1 }
      : null;
    // The target (query, URL, description …): it must keep some room on the row.
    const targetEl = row.querySelector("[data-row-target], [data-path]");
    const target = targetEl ? { text: (targetEl.textContent ?? "").slice(0, 60), width: +targetEl.getBoundingClientRect().width.toFixed(2) } : null;
    // The text glyphs of the verb (unless its ellipsis cuts it: then its box
    // holds the visible part) and of the right group, line by line.
    const glyphs = [];
    for (const host of [verb && !verb.cut ? verbEl : null, right].filter(Boolean)) {
      const walker = document.createTreeWalker(host, 4 /* SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.nodeValue ?? "").trim() === "") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0.5) glyphs.push({ text: node.nodeValue.trim().slice(0, 40), rect: rect(r) });
      }
    }
    const icon = row.querySelector("[data-outcome-icon]");
    let status = null;
    if (icon) {
      const span = icon.parentElement;
      const range = document.createRange();
      range.selectNodeContents(span);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0).map(rect);
      let ellipsis = false;
      for (let el = span; el && el !== wrapper; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) ellipsis = true;
      }
      status = { text: (span.textContent ?? "").trim(), lines, ellipsis, scrollWidth: span.scrollWidth, clientWidth: span.clientWidth };
    }
    const detail = wrapper.querySelector("[data-tool-detail]:not([hidden])");
    const copyButton = detail?.querySelector(":scope > [data-meta] > button:last-child") ?? null;
    let copy = null;
    if (copyButton) {
      const r = copyButton.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      copy = { text: copyButton.textContent, rect: rect(r), hitIsButton: !!hit && (hit === copyButton || copyButton.contains(hit)), hit: hit ? `${hit.tagName}.${hit.getAttribute("class") ?? ""}` : null };
    }
    return { viewport: innerWidth, box, head: (row.innerText ?? "").replace(/\s+/g, " "), verb, pieces, glyphs, target, status, open: !!detail, copy };
  });

const inside = (r, box) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;

describe.skipIf(!ENABLED)("tool rows: head pieces and the copy control stay inside the row (real WebKit, raw Claude records)", () => {
  describe.each(CONFIGS)("$label", (config) => {
    const measured = new Map();
    let session;

    beforeAll(async () => {
      session = await openScenario(browser, app, config.scenario, { locale: config.locale, variant: config.variant });
      const run = createActions({ session, scenario: SCENARIOS.get(config.scenario), manifest: app.fixture, t: session.t });
      for (const c of CASES) {
        if (!(await markRow(session.page, c.anchor))) {
          measured.set(c.id, null);
          continue;
        }
        await settle(session, { label: `fit ${c.id}` });
        // The list may re-render on scroll: mark again, then measure the collapsed head.
        await markRow(session.page, c.anchor);
        const collapsed = await rowGeometry(session.page);
        await run({ do: "expandToolRows", match: [c.anchor], limit: 1 });
        await settle(session, { label: `fit ${c.id} open` });
        await markRow(session.page, c.anchor);
        await settle(session, { label: `fit ${c.id} centred` });
        await markRow(session.page, c.anchor);
        measured.set(c.id, { collapsed, opened: await rowGeometry(session.page) });
      }
    }, 240_000);

    afterAll(async () => {
      await session?.close();
    });

    it.each(CASES.map((c) => [c.id, c]))("%s: head pieces, status and copy control inside the row", (_id, c) => {
      const m = measured.get(c.id);
      expect(m, `row for ${c.id} not found in the transcript`).toBeTruthy();
      for (const g of [m.collapsed, m.opened]) {
        const detail = JSON.stringify(g);
        expect(g.pieces.length, `empty head: ${detail}`).toBeGreaterThan(2);
        expect(g.verb, `no verb: ${detail}`).not.toBeNull();
        expect(g.verb.text, "the verb is the recorded tool name").toBe(c.name);
        expect(g.verb.title, "the verb's title keeps the whole name").toBe(c.name);
        expect(inside(g.verb.rect, g.box), `verb box leaves the row: ${detail}`).toBe(true);
        expect(g.target, `no target in the row: ${detail}`).not.toBeNull();
        expect(g.target.width, `the target has no room on the row: ${detail}`).toBeGreaterThan(40);
        for (const piece of g.pieces) expect(inside(piece.rect, g.box), `head piece <${piece.tag}> "${piece.text}" leaves the row: ${detail}`).toBe(true);
        for (const glyph of g.glyphs) expect(inside(glyph.rect, g.box), `text "${glyph.text}" leaves the row: ${detail}`).toBe(true);
        if (c.status) {
          expect(g.status, `no status shown: ${detail}`).not.toBeNull();
          const expected = c.status === "noResult" ? session.t("toolOutcome.noResult") : session.t("toolOutcome.failedErrorCode").replace("{{code}}", "url_not_accessible");
          expect(g.status.text).toBe(expected);
          expect(g.status.lines.length, detail).toBeGreaterThan(0);
          for (const line of g.status.lines) expect(inside(line, g.box), `status "${g.status.text}" clipped: ${detail}`).toBe(true);
          expect(g.status.ellipsis, `status ellipsised: ${detail}`).toBe(false);
          expect(g.status.scrollWidth, `status wider than its box: ${detail}`).toBeLessThanOrEqual(g.status.clientWidth + 1);
        } else {
          expect(g.status, `unexpected status: ${detail}`).toBeNull();
        }
      }
      const opened = m.opened;
      const detail = JSON.stringify(opened);
      expect(opened.open, `the row did not open: ${detail}`).toBe(true);
      expect(opened.copy, `no copy control at the end of the detail meta line: ${detail}`).not.toBeNull();
      expect(opened.copy.text).toBe(session.t("toolRow.copyToolId"));
      expect(inside(opened.copy.rect, opened.box), `copy control outside the row: ${detail}`).toBe(true);
      expect(opened.copy.hitIsButton, `copy control is not the hit target at its centre: ${detail}`).toBe(true);
    });
  });
});

describe.skipIf(!ENABLED)("transcript-failure: the url_not_accessible WebFetch row says Failed (real WebKit)", () => {
  it.each([
    ["1440x900 en", "transcript-failure--1440x900--dark", "en", {}],
    ["390x844 ko, font scale 125%", "transcript-failure--390x844--dark", "ko", { fontScale: 1.25 }],
  ])("%s", async (_label, scenario, locale, variant) => {
    const session = await openScenario(browser, app, scenario, { locale, variant });
    try {
      const found = await session.page.evaluate(() => {
        const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes("status.example.com/api"));
        if (!row) return null;
        row.scrollIntoView({ block: "center" });
        return true;
      });
      expect(found, "the url_not_accessible WebFetch row").toBe(true);
      await settle(session, { label: "failure webfetch" });
      const status = await session.page.evaluate(() => {
        const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes("status.example.com/api"));
        return {
          verdict: row?.getAttribute("data-tool-verdict") ?? null,
          verb: row?.querySelector("[data-tool-verb]")?.textContent ?? null,
          status: (row?.querySelector("[data-outcome-icon]")?.parentElement?.textContent ?? "").trim(),
        };
      });
      expect(status.verb).toBe("WebFetch");
      expect(status.verdict).toBe("failed");
      expect(status.status).toBe(session.t("toolOutcome.failedErrorCode").replace("{{code}}", "url_not_accessible"));
    } finally {
      await session.close();
    }
  }, 120_000);
});
