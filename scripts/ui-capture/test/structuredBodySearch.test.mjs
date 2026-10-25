// Every search hit counted in a routed Default body's input is marked in the
// opened row (TR1a fix round 2, review R2-F1 / R2-F2).
//
// Real WebKit, the real server, raw Claude records: the reviewer's three
// app-reachable cases. A NotebookEdit path searched across its folder /
// file-name split (`notebooks/report.ipynb`), an `update_plan` step's
// recorded status (`pending`, shown as the label "Pending") and an OpenCode
// `todowrite` item's status (`in_progress`, drawn as an icon). Each query is
// counted (1/1) and opens the row; before the fix nothing in it was marked.
//
// Planted into the generated "unknown-outcome" session (fixture copy owned
// by this file): one assistant turn with the three calls and their results.
// Per case, a fresh page at 1440x900 en runs the conversation search through
// the harness step (`transcriptSearch`, which waits with `settle()`), then
// the matching row is open and its marks (a split path hit joined) hold the
// query. Skipped without WebKit or a built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "structuredBodySearch.test" }).enabled;

const SCENARIO = "transcript-unknown-outcome--1440x900--dark";
const CASES = [
  { id: "toolu_hit_path_span", name: "NotebookEdit", input: { notebook_path: "/work/notebooks/report.ipynb", new_source: "x=1" }, query: "notebooks/report.ipynb" },
  { id: "toolu_hit_plan_label", name: "update_plan", input: { plan: [{ step: "Review the code", status: "pending" }] }, query: "pending" },
  { id: "toolu_hit_todo_status", name: "todowrite", input: { todos: [{ content: "Audit the code", status: "in_progress" }] }, query: "in_progress" },
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
    { type: "text", text: "Editing the notebook, the plan and the todo list." },
    ...CASES.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
  ];
  const records = [question, assistant];
  CASES.forEach((c, i) => {
    const record = {
      ...structuredClone(resultTemplate),
      uuid: `hit-result-${i}`,
      parentUuid: assistant.uuid,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: c.id, content: "Done." }] },
    };
    delete record.toolUseResult;
    records.push(record);
  });
  fs.writeFileSync(session.filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("structured-body-search");
  plantCases(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe.skipIf(!ENABLED)("a counted search hit in a routed Default body is marked in the opened row (real WebKit, raw records)", () => {
  it.each(CASES.map((c) => [`${c.name} · ${c.query}`, c]))("%s", async (_label, c) => {
    const session = await openScenario(browser, app, SCENARIO, { locale: "en" });
    try {
      const run = createActions({ session, scenario: expandScenarios().find((s) => s.id === SCENARIO), manifest: app.fixture, t: session.t });
      await run({ do: "transcriptSearch", query: c.query });
      const state = await session.page.evaluate(
        ({ name }) => {
          const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes(name));
          const wrapper = row?.closest("[data-tool-row-wrapper]");
          const detail = wrapper?.querySelector("[data-tool-detail]:not([hidden])");
          // A path hit split over the folder / name parts is two pieces: join them.
          const hits = [];
          let open = null;
          for (const mark of wrapper?.querySelectorAll("mark") ?? []) {
            const piece = (mark.textContent ?? "").replace(/\u2060/g, "");
            const part = mark.getAttribute("data-search-hit-part");
            if (open !== null && part === "end") {
              hits.push(open + piece);
              open = null;
            } else if (part === "start") open = piece;
            else hits.push(piece);
          }
          return { found: Boolean(row), open: Boolean(detail), hits: hits.map((h) => h.toLowerCase()), body: (document.body.innerText ?? "").slice(0, 400) };
        },
        { name: c.name },
      );
      expect(state.body, "the app is not replaced by its error screen").not.toContain(session.t("error.unexpectedError"));
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
      expect(state.found, `the ${c.name} row is in the transcript`).toBe(true);
      expect(state.open, "the search hit opened the row").toBe(true);
      expect(state.hits, `a <mark> in the opened row reads ${JSON.stringify(c.query)}`).toContain(c.query);
    } finally {
      await session.close();
    }
  }, 120_000);
});
