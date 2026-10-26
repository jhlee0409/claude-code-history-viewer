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
import { PNG } from "pngjs";
import { settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, innerWidth, innerHeight */

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

// Review round 1 (PR #746) F1 / F2, planted into the "mixed-turn" session:
// - an outer Bash result whose content array holds a completed nested Edit
//   with its result (a distinct, non-confirmation text) and a nested Task
//   whose result has text, an image and a second text block (F1: the pairing
//   must keep every recorded result part visible);
// - an assistant message holding only a `web_search_tool_result` whose call
//   is not recorded (F2: the counted title opens the row and is marked);
// - a paired server call as the positive control.
const REVIEW_BASH = "cat release/review-records.json";
const REVIEW_EDIT_RESULT = "ZephyrEditResult: formatter adjusted indentation; verify the result before publishing.";
const REVIEW_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Review round 2 (PR #746) R2-F1, the review's repro: an outer Bash result
// whose content array holds a nested Task and its result recorded as image →
// text → text. The image is short and wide (400×20, red) so it and the
// following text fit one screen at 390 ko 125 %.
const LEADING_BASH = "cat leading-order.json";
function leadingImageData() {
  const png = new PNG({ width: 400, height: 20 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([220, 30, 50, 255], i);
  return PNG.sync.write(png).toString("base64");
}
const LEADING_PNG = leadingImageData();

function plantReview(fixture) {
  const project = fixture.projects.find((p) => p.name === "kiln-renderers");
  const session = project.sessions.find((s) => s.title === fixture.namedSessions["mixed-turn"].title);
  const old = fs
    .readFileSync(session.filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const question = old.find((r) => r.type === "user" && typeof r.message?.content === "string");
  const assistantTemplate = old.find((r) => r.type === "assistant");
  let previous = question.uuid;
  let n = 0;
  const record = (type, content) => {
    n += 1;
    const r = structuredClone(type === "assistant" ? assistantTemplate : question);
    delete r.toolUseResult;
    delete r.toolUse;
    Object.assign(r, { type, uuid: `review-746-${n}`, parentUuid: previous, timestamp: new Date(Date.parse(question.timestamp) + n * 1000).toISOString() });
    r.message = type === "assistant" ? { ...structuredClone(assistantTemplate.message), id: `msg_review746_${n}`, content } : { role: "user", content };
    previous = r.uuid;
    return r;
  };
  const nested = [
    { type: "text", text: "nested recorded tools" },
    { type: "tool_use", id: "nested_edit", name: "Edit", input: { file_path: "release/notes.md", old_string: "before", new_string: "after" } },
    { type: "tool_result", tool_use_id: "nested_edit", content: REVIEW_EDIT_RESULT },
    { type: "tool_use", id: "nested_task", name: "Task", input: { description: "Audit the release notes", prompt: "Check the notes." } },
    {
      type: "tool_result",
      tool_use_id: "nested_task",
      content: [
        { type: "text", text: "ZephyrTaskFirst: the notes are fine." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: REVIEW_PNG } },
        { type: "text", text: "agentId: ZephyrTaskAgent (for resuming)" },
      ],
    },
  ];
  const records = [
    question,
    record("assistant", [{ type: "tool_use", id: "outer_bash", name: "Bash", input: { command: REVIEW_BASH } }]),
    record("user", [{ type: "tool_result", tool_use_id: "outer_bash", content: nested }]),
    record("assistant", [{ type: "web_search_tool_result", tool_use_id: "missing_server_call", content: [{ type: "web_search_result", title: "ZephyrOrphanTitle", url: "https://example.test/zephyr", page_age: "2026-10-01" }] }]),
    record("assistant", [
      { type: "server_tool_use", id: "srv_search", name: "web_search", input: { query: "paired search control" } },
      { type: "web_search_tool_result", tool_use_id: "srv_search", content: [{ type: "web_search_result", title: "ZephyrPairedTitle", url: "https://example.test/paired" }] },
    ]),
    record("assistant", [{ type: "tool_use", id: "outer_leading", name: "Bash", input: { command: LEADING_BASH } }]),
    record("user", [
      {
        type: "tool_result",
        tool_use_id: "outer_leading",
        content: [
          { type: "tool_use", id: "nested_leading_task", name: "Task", input: { description: "Leading image order", prompt: "Describe the capture" } },
          {
            type: "tool_result",
            tool_use_id: "nested_leading_task",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: LEADING_PNG } },
              { type: "text", text: "ZephyrAfterImage: recorded AFTER the red image." },
              { type: "text", text: "agentId: ZephyrLeadingAgent\n<usage>total_tokens: 48211</usage>" },
            ],
          },
        ],
      },
    ]),
    record("assistant", [{ type: "text", text: "End of the review fixture." }]),
  ];
  fs.writeFileSync(session.filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("legacy-rows");
  plant(app.fixture);
  plantReview(app.fixture);
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

const REVIEW_CONFIGS = [
  { label: "1440x900 en", scenario: "transcript-mixed-turn--1440x900--dark", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125%", scenario: "transcript-mixed-turn--390x844--dark", locale: "ko", variant: { fontScale: 1.25 } },
];

/** The message `uuid`'s visible text, its marks, its row toggles and images; the search counter. */
const messageState = (page, uuid) =>
  page.evaluate((ids) => {
    // The backend may merge a tool result into its call's message: read every listed uuid together.
    const messages = ids.map((id) => document.querySelector(`[data-message-uuid="${id}"]`)).filter(Boolean);
    const message = messages.length === 0 ? null : { innerText: messages.map((m) => m.innerText).join("\n"), querySelectorAll: (sel) => messages.flatMap((m) => [...m.querySelectorAll(sel)]) };
    const counter = [...document.querySelectorAll("main span")].map((el) => (el.textContent ?? "").trim()).find((s) => /^\d+\/\d+$/.test(s)) ?? null;
    return {
      found: Boolean(message),
      text: (message?.innerText ?? "").replace(/\u2060/g, ""),
      marks: [...(message?.querySelectorAll("mark") ?? [])].map((m) => (m.textContent ?? "").replace(/\u2060/g, "")),
      toggles: [...(message?.querySelectorAll("[data-tool-row] > button[aria-expanded]") ?? [])].map((b) => b.getAttribute("aria-expanded")),
      images: [...(message?.querySelectorAll("img") ?? [])].filter((img) => (img.getAttribute("src") ?? "").startsWith("data:image/png;base64,")).length,
      counter,
      body: (document.body.innerText ?? "").slice(0, 300),
    };
  }, [uuid].flat());

describe.skipIf(!ENABLED)("TR1b review round 1: nested results stay visible; an orphan server result's search hit is revealed (real WebKit, raw Claude records)", () => {
  describe.each(REVIEW_CONFIGS)("$label", (config) => {
    let session;
    let run;

    beforeAll(async () => {
      session = await openScenario(browser, app, config.scenario, { locale: config.locale, variant: config.variant });
      run = createActions({ session, scenario: SCENARIOS.get(config.scenario), manifest: app.fixture, t: session.t });
    }, 240_000);

    afterAll(async () => {
      await session?.close();
    });

    it("F1: opening the outer Bash row and its nested rows shows the nested Edit's result and every part of the nested Task's result", async () => {
      await run({ do: "expandToolRows", match: [REVIEW_BASH], limit: 1 });
      await settle(session, { label: "review outer bash open" });
      // Open each nested row still closed (DOM click: the rows sit inside an opened detail).
      for (let guard = 0; guard < 8; guard += 1) {
        const clicked = await session.page.evaluate(() => {
          const button = document.querySelector(
            ':is([data-message-uuid="review-746-1"], [data-message-uuid="review-746-2"]) [data-tool-detail] [data-tool-row] > button[aria-expanded="false"]',
          );
          button?.click();
          return Boolean(button);
        });
        if (!clicked) break;
        await settle(session, { label: `review nested open ${guard}` });
      }
      const state = await messageState(session.page, ["review-746-1", "review-746-2"]);
      expect(state.found, "the outer Bash result message is in the transcript").toBe(true);
      expect(state.body, "the app is not replaced by its error screen").not.toContain(session.t("error.unexpectedError"));
      expect(state.text, "the nested Edit's recorded result").toContain("ZephyrEditResult: formatter adjusted indentation");
      expect(state.text, "the nested Task's first text block").toContain("ZephyrTaskFirst");
      expect(state.text, "the nested Task's second text block").toContain("ZephyrTaskAgent");
      expect(state.images, "the nested Task result's image").toBeGreaterThan(0);
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
    }, 120_000);

    it("F2: searching an orphan web_search result's title counts it, opens its row and marks it; the paired call is the control", async () => {
      await run({ do: "transcriptSearch", query: "ZephyrOrphanTitle" });
      const orphan = await messageState(session.page, "review-746-3");
      expect(orphan.counter, "the conversation search counts the orphan's title").toBe("1/1");
      expect(orphan.found).toBe(true);
      expect(orphan.toggles, "the orphan's row opened").toEqual(["true"]);
      expect(orphan.text).toContain("ZephyrOrphanTitle");
      expect(orphan.marks, "the counted hit is marked").toContain("ZephyrOrphanTitle");
      await run({ do: "transcriptSearch", query: "ZephyrPairedTitle" });
      const paired = await messageState(session.page, "review-746-4");
      expect(paired.counter).toBe("1/1");
      expect(paired.marks, "control: the paired call marks its result title").toContain("ZephyrPairedTitle");
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
    }, 120_000);

    it("R2-F1: a nested Task result recorded image → text → text shows the image first, then each text, on screen", async () => {
      await run({ do: "expandToolRows", match: [LEADING_BASH], limit: 1 });
      await settle(session, { label: "leading outer bash open" });
      const scope = ':is([data-message-uuid="review-746-5"], [data-message-uuid="review-746-6"])';
      for (let guard = 0; guard < 8; guard += 1) {
        const clicked = await session.page.evaluate((sel) => {
          const button = document.querySelector(`${sel} [data-tool-detail] [data-tool-row] > button[aria-expanded="false"]`);
          button?.click();
          return Boolean(button);
        }, scope);
        if (!clicked) break;
        await settle(session, { label: `leading nested open ${guard}` });
      }
      // Bring the image into view, let the virtual list re-measure, then read DOM order and geometry.
      await session.page.evaluate(
        ({ sel, data }) => document.querySelector(`${sel} img[src$="${data.slice(-24)}"]`)?.scrollIntoView({ block: "center" }),
        { sel: scope, data: LEADING_PNG },
      );
      await settle(session, { label: "leading image in view" });
      const order = await session.page.evaluate(
        ({ sel, data }) => {
          const image = [...document.querySelectorAll(`${sel} img`)].find((img) => img.getAttribute("src") === `data:image/png;base64,${data}`);
          const textNode = (needle) => {
            for (const message of document.querySelectorAll(sel)) {
              const walker = document.createTreeWalker(message, 4 /* SHOW_TEXT */);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) if ((node.textContent ?? "").includes(needle)) return node;
            }
            return null;
          };
          const rectOf = (node) => {
            if (!node) return null;
            const range = document.createRange();
            range.selectNodeContents(node);
            const r = node.nodeType === 1 ? node.getBoundingClientRect() : range.getBoundingClientRect();
            return { top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), height: +r.height.toFixed(2) };
          };
          const after = textNode("ZephyrAfterImage");
          const agent = textNode("ZephyrLeadingAgent");
          const follows = (a, b) => Boolean(a && b && a.compareDocumentPosition(b) & 4 /* DOCUMENT_POSITION_FOLLOWING */);
          return {
            image: rectOf(image),
            after: rectOf(after),
            agent: rectOf(agent),
            imageThenAfter: follows(image, after),
            afterThenAgent: follows(after, agent),
            innerHeight,
            body: (document.body.innerText ?? "").slice(0, 300),
          };
        },
        { sel: scope, data: LEADING_PNG },
      );
      expect(order.body, "the app is not replaced by its error screen").not.toContain(session.t("error.unexpectedError"));
      expect(order.image, "the nested Task result's image is rendered").not.toBeNull();
      expect(order.after, "the text recorded after the image is rendered").not.toBeNull();
      expect(order.agent, "the agentId text is rendered").not.toBeNull();
      expect(order.imageThenAfter, `DOM order: the image precedes the text recorded after it ${JSON.stringify(order)}`).toBe(true);
      expect(order.afterThenAgent, "DOM order: the two texts keep their order").toBe(true);
      expect(order.image.bottom, `on screen: the image sits above the text recorded after it ${JSON.stringify(order)}`).toBeLessThanOrEqual(order.after.top);
      expect(order.after.top < order.innerHeight && order.image.top >= 0, `both are in the viewport ${JSON.stringify(order)}`).toBe(true);
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
    }, 120_000);
  });
});
