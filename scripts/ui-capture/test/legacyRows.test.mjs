// TR1b: the Claude legacy / unpaired tool paths are ToolRows (real WebKit,
// the real server, raw Claude records).
//
// Planted into the generated "unknown-outcome" session (fixture copy owned
// by this file): one assistant turn with
// - a `server_tool_use` web_search and its `web_search_tool_result` (one
//   row: the call, its result in the Result zone);
// - an `mcp_tool_use` with long server / tool names and its failed
//   `mcp_tool_result` ("Failed" in the row);
// - a Bash call whose result's content array holds two nested tool_use
//   blocks with malformed list members (`update_plan` `plan: [null]`,
//   `TodoWrite` `todos: [null]`, issue #734): opening the Bash row renders
//   the nested calls (default-open inside a result), which used to throw
//   `null.status` and replace the app with its error screen;
// and a user record with an orphan `tool_result` whose call is in no
// loaded message (a page-boundary orphan's row; this one-page session says
// "Call not recorded").
//
// For every new row, at 390x844 en, 390x844 ko at font scale 125% and
// 1180x760 en: every head piece and glyph is inside the row box, the
// target keeps room (> 40px), the verb is the recorded name, the row opens
// through the harness step (`expandToolRows`, which waits with `settle()`),
// "Copy tool ID" is the element hit at its centre and inside the row, and
// every zone caption line of the opened detail fits its box
// (`scrollWidth <= clientWidth`). Plus #734: no error screen, no page
// error, and the nested calls' recorded input as JSON.
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

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "legacyRows.test" }).enabled;

const SEARCH_QUERY = "Retry-After HTTP-date delta-seconds RFC 9110 semantics";
const MCP_SERVER = "kiln_production_deploy";
const MCP_TOOL = "deploy_preview_environment_for_branch";
const MCP_TARGET = "Deploy release/2.4-preview-environment";
const BASH_COMMAND = "cat release/nested-plan.json";

/**
 * Each measured row: `anchor` finds it (text in its head; a function gets the
 * page's `t`), `verb` is the recorded name it must show (a function: a
 * translated verb), `status` the OutcomeStatus key it shows (null: quiet).
 */
const ROWS = [
  { id: "web_search", anchor: () => SEARCH_QUERY, verb: () => "web_search", status: null },
  { id: "mcp", anchor: () => MCP_TARGET, verb: () => MCP_TOOL, status: "toolOutcome.failed" },
  { id: "orphan", anchor: (t) => t("toolRow.callNotRecorded"), verb: (t) => t("toolRow.resultZone"), status: null },
  { id: "bash-nested", anchor: () => BASH_COMMAND, verb: () => "Bash", status: null, nested: true },
];

const CONFIGS = [
  { label: "390x844 en", scenario: "transcript-unknown-outcome--390x844--dark", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125%", scenario: "transcript-unknown-outcome--390x844--dark", locale: "ko", variant: { fontScale: 1.25 } },
  { label: "1180x760 en", scenario: "transcript-unknown-outcome--1180x760--dark", locale: "en", variant: {} },
];

const SCENARIOS = new Map(expandScenarios().map((s) => [s.id, s]));

let app;
let browser;

function plant(fixture) {
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
    { type: "text", text: "Searching, deploying and reading the plan." },
    { type: "server_tool_use", id: "srvtoolu_tr1b_search", name: "web_search", input: { query: SEARCH_QUERY } },
    {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_tr1b_search",
      content: [
        { type: "web_search_result", url: "https://www.rfc-editor.org/rfc/rfc9110#field.retry-after", title: "RFC 9110: HTTP Semantics - Retry-After", encrypted_content: "x", page_age: "2022-06-01" },
        { type: "web_search_result", url: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Retry-After", title: "Retry-After - HTTP | MDN", encrypted_content: "x" },
      ],
    },
    {
      type: "mcp_tool_use",
      id: "mcptoolu_tr1b_deploy",
      server_name: MCP_SERVER,
      tool_name: MCP_TOOL,
      input: { description: MCP_TARGET, branch: "release/2.4", environment_configuration_override_for_preview_builds: "default" },
    },
    { type: "mcp_tool_result", tool_use_id: "mcptoolu_tr1b_deploy", is_error: true, content: [{ type: "text", text: "Preview environment quota exceeded" }] },
    { type: "tool_use", id: "toolu_tr1b_bash_nested", name: "Bash", input: { command: BASH_COMMAND, description: "Read the nested plan" } },
  ];
  const bashResult = {
    ...structuredClone(resultTemplate),
    uuid: "tr1b-bash-result",
    parentUuid: assistant.uuid,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_tr1b_bash_nested",
          content: [
            { type: "text", text: "nested calls below" },
            { type: "tool_use", id: "nested-plan", name: "update_plan", input: { plan: [null] } },
            { type: "tool_use", id: "nested-todos", name: "TodoWrite", input: { todos: [null] } },
          ],
        },
      ],
    },
  };
  delete bashResult.toolUseResult;
  const orphan = {
    ...structuredClone(resultTemplate),
    uuid: "tr1b-orphan-result",
    parentUuid: "tr1b-bash-result",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_tr1b_orphan_call_elsewhere_00", content: "ok: 3 files changed in release/notes" }] },
  };
  delete orphan.toolUseResult;
  fs.writeFileSync(session.filePath, [question, assistant, bashResult, orphan].map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("legacy-rows");
  plant(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Mark the top-level row whose head shows `text`, centre it; `false` if absent. */
const markRow = (page, text) =>
  page.evaluate((needle) => {
    const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find(
      (el) => (el.innerText ?? "").includes(needle) && !el.closest("[data-tool-detail]"),
    );
    const wrapper = row?.closest("[data-tool-row-wrapper]");
    if (!wrapper) return false;
    document.querySelectorAll("[data-fit-row]").forEach((el) => el.removeAttribute("data-fit-row"));
    wrapper.setAttribute("data-fit-row", "");
    wrapper.scrollIntoView({ block: "center" });
    return true;
  }, text);

const rowGeometry = (page) =>
  page.evaluate(() => {
    const wrapper = document.querySelector("[data-fit-row]");
    if (!wrapper) return null;
    const row = wrapper.querySelector(":scope > [data-tool-row]");
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) });
    const box = rect(wrapper.getBoundingClientRect());
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const button = row.querySelector(":scope > button[aria-expanded]");
    const right = row.lastElementChild;
    const pieces = [...button.children, ...right.querySelectorAll(":scope > *, :scope > * > *")]
      .filter(visible)
      .map((el) => ({ tag: el.tagName, text: (el.textContent ?? "").trim().slice(0, 60), rect: rect(el.getBoundingClientRect()) }));
    const verbEl = row.querySelector("[data-tool-verb]");
    const verb = verbEl
      ? { text: verbEl.textContent, title: verbEl.getAttribute("title"), rect: rect(verbEl.getBoundingClientRect()), cut: getComputedStyle(verbEl).textOverflow === "ellipsis" && verbEl.scrollWidth > verbEl.clientWidth + 1 }
      : null;
    const targetEl = button.querySelector("[data-row-target], [data-path]");
    const target = targetEl ? { text: (targetEl.textContent ?? "").slice(0, 60), width: +targetEl.getBoundingClientRect().width.toFixed(2) } : null;
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
    const icon = row.querySelector(":scope > :last-child [data-outcome-icon]");
    const status = icon ? (icon.parentElement.textContent ?? "").trim() : null;
    const detail = wrapper.querySelector(":scope > [data-tool-detail]:not([hidden])");
    // Zone captions are measured before the copy control scrolls the page (same coordinates as `box`).
    const captions = detail
      ? [...detail.querySelectorAll("[data-zone-label]")].map((el) => ({ text: (el.textContent ?? "").slice(0, 80), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, rect: rect(el.getBoundingClientRect()) }))
      : [];
    const copyButton = detail?.querySelector(":scope > [data-meta] > button:last-child") ?? null;
    let copy = null;
    if (copyButton) {
      // An opened row can be taller than the viewport: bring the control into
      // view (centred, clear of a phone's bottom bar) before the hit test, and
      // compare it with the row box measured in the same scroll position.
      copyButton.scrollIntoView({ block: "center", inline: "nearest" });
      const r = copyButton.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      copy = {
        text: copyButton.textContent,
        rect: rect(r),
        box: rect(wrapper.getBoundingClientRect()),
        hitIsButton: !!hit && (hit === copyButton || copyButton.contains(hit)),
        hit: hit ? `${hit.tagName}.${hit.getAttribute("class") ?? ""}` : null,
      };
    }
    return { viewport: innerWidth, box, verb, pieces, glyphs, target, status, open: !!detail, copy, captions, detailText: detail ? (detail.textContent ?? "") : null };
  });

const inside = (r, box) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;

describe.skipIf(!ENABLED)("TR1b rows: server / MCP / orphan / nested calls are ToolRows that fit (real WebKit, raw Claude records)", () => {
  describe.each(CONFIGS)("$label", (config) => {
    const measured = new Map();
    let session;
    let afterOpen = null;

    beforeAll(async () => {
      session = await openScenario(browser, app, config.scenario, { locale: config.locale, variant: config.variant });
      const run = createActions({ session, scenario: SCENARIOS.get(config.scenario), manifest: app.fixture, t: session.t });
      for (const r of ROWS) {
        const anchor = r.anchor(session.t);
        // A probe failure (row absent, re-render) is recorded, never thrown: the case then fails on its assertion.
        const measureRow = async (label) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (await markRow(session.page, anchor)) return rowGeometry(session.page);
            await settle(session, { label: `${label} retry ${attempt}` });
          }
          return null;
        };
        try {
          if (!(await markRow(session.page, anchor))) {
            measured.set(r.id, null);
            continue;
          }
          await settle(session, { label: `tr1b ${r.id}` });
          const collapsed = await measureRow(`tr1b ${r.id}`);
          await run({ do: "expandToolRows", match: [anchor], limit: 1 });
          await settle(session, { label: `tr1b ${r.id} open` });
          await markRow(session.page, anchor);
          await settle(session, { label: `tr1b ${r.id} centred` });
          const opened = await measureRow(`tr1b ${r.id} opened`);
          measured.set(r.id, collapsed && opened ? { collapsed, opened } : null);
        } catch (error) {
          measured.set(r.id, { error: String(error?.message ?? error).slice(0, 300) });
        }
        if (r.nested) {
          afterOpen = await session.page.evaluate(() => ({
            body: (document.body.innerText ?? "").slice(0, 400),
            transcript: document.querySelectorAll("[data-message-uuid]").length,
            nestedRows: [...document.querySelectorAll("[data-tool-detail] [data-tool-row]")].map((el) => {
              const wrapper = el.closest("[data-tool-row-wrapper]");
              const detail = wrapper.querySelector(":scope > [data-tool-detail]:not([hidden])");
              return { verb: el.querySelector("[data-tool-verb]")?.textContent ?? null, detail: detail ? (detail.textContent ?? "") : null };
            }),
          }));
        }
      }
    }, 240_000);

    afterAll(async () => {
      await session?.close();
    });

    it.each(ROWS.map((r) => [r.id, r]))("%s: head pieces, target room, copy control and zone captions inside the row", (_id, r) => {
      const m = measured.get(r.id);
      expect(m, `row for ${r.id} not found in the transcript`).toBeTruthy();
      expect(m.error, `probe for ${r.id} failed`).toBeUndefined();
      for (const g of [m.collapsed, m.opened]) {
        const detail = JSON.stringify(g);
        expect(g.verb, `no verb: ${detail}`).not.toBeNull();
        expect(g.verb.text, "the verb is the recorded name").toBe(r.verb(session.t));
        expect(g.verb.title).toBe(r.verb(session.t));
        expect(inside(g.verb.rect, g.box), `verb leaves the row: ${detail}`).toBe(true);
        expect(g.target, `no target: ${detail}`).not.toBeNull();
        expect(g.target.width, `the target has no room: ${detail}`).toBeGreaterThan(40);
        for (const piece of g.pieces) expect(inside(piece.rect, g.box), `head piece <${piece.tag}> "${piece.text}" leaves the row: ${detail}`).toBe(true);
        for (const glyph of g.glyphs) expect(inside(glyph.rect, g.box), `text "${glyph.text}" leaves the row: ${detail}`).toBe(true);
        if (r.status) expect(g.status).toBe(session.t(r.status));
        else expect(g.status, `unexpected status: ${detail}`).toBeNull();
      }
      const opened = m.opened;
      const detail = JSON.stringify(opened);
      expect(opened.open, `the row did not open: ${detail}`).toBe(true);
      expect(opened.copy, `no copy control at the end of the detail meta line: ${detail}`).not.toBeNull();
      expect(opened.copy.text).toBe(session.t("toolRow.copyToolId"));
      expect(inside(opened.copy.rect, opened.copy.box), `copy control outside the row: ${detail}`).toBe(true);
      expect(opened.copy.hitIsButton, `copy control is not the hit target at its centre: ${detail}`).toBe(true);
      expect(opened.captions.length, `no zone caption in the opened detail: ${detail}`).toBeGreaterThan(0);
      for (const c of opened.captions) {
        expect(c.scrollWidth, `zone caption "${c.text}" overflows: ${detail}`).toBeLessThanOrEqual(c.clientWidth);
        expect(inside(c.rect, opened.box), `zone caption "${c.text}" leaves the row: ${detail}`).toBe(true);
      }
    });

    it("#734: the nested malformed calls open as JSON; the app keeps its transcript", () => {
      expect(afterOpen, "the Bash row with the nested calls was opened").not.toBeNull();
      expect(afterOpen.body, "the app is not replaced by its error screen").not.toContain(session.t("error.unexpectedError"));
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
      expect(afterOpen.transcript).toBeGreaterThan(0);
      const plan = afterOpen.nestedRows.find((n) => n.verb === "update_plan");
      const todos = afterOpen.nestedRows.find((n) => n.verb === "TodoWrite");
      expect(plan?.detail ?? "", JSON.stringify(afterOpen.nestedRows)).toContain('"plan": [');
      expect(todos?.detail ?? "", JSON.stringify(afterOpen.nestedRows)).toContain('"todos": [');
    });
  });
});
