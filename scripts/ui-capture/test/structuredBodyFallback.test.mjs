// A malformed structured tool input opens as JSON and keeps the app (TR1a
// fix round 1, review F1).
//
// Real WebKit, the real server, raw Claude records. TR1a routes the Default
// path's tool names to structured bodies (todo list, plan steps). A readable
// JSON record whose array holds a non-object member (`update_plan` with
// `plan: [null]`, OpenCode's lower-case `todowrite` with `todos: [null]`)
// reached those bodies, threw on `null.status`, and the whole app turned
// into the error screen ("An unexpected error occurred") when the row was
// opened. The shape gate sends such input to the honest JSON body instead.
//
// Planted into the generated "unknown-outcome" session (fixture copy owned
// by this file): one assistant turn with both calls and their results. Per
// case, a fresh page at 1440x900 en opens the row through the harness step
// (`expandToolRows`, which waits with `settle()`), then: no error screen,
// no page error, the transcript is still there and the opened row shows the
// recorded input as JSON. Skipped without WebKit or a built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "structuredBodyFallback.test" }).enabled;

const SCENARIO = "transcript-unknown-outcome--1440x900--dark";
const CASES = [
  { id: "toolu_shape_plan_null", name: "update_plan", input: { plan: [null] }, result: "Plan updated", json: ['"plan": [', "null"] },
  { id: "toolu_shape_todo_null", name: "todowrite", input: { todos: [null] }, result: "Todos updated", json: ['"todos": [', "null"] },
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
    { type: "text", text: "Updating the plan and the todo list." },
    ...CASES.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
  ];
  const records = [question, assistant];
  CASES.forEach((c, i) => {
    const record = {
      ...structuredClone(resultTemplate),
      uuid: `shape-result-${i}`,
      parentUuid: assistant.uuid,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: c.id, content: c.result }] },
    };
    delete record.toolUseResult;
    records.push(record);
  });
  fs.writeFileSync(session.filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("structured-body-fallback");
  plantCases(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe.skipIf(!ENABLED)("a malformed structured tool input opens as JSON and keeps the app (real WebKit, raw records)", () => {
  it.each(CASES.map((c) => [`${c.name} ${JSON.stringify(c.input)}`, c]))("%s", async (_label, c) => {
    const session = await openScenario(browser, app, SCENARIO, { locale: "en" });
    try {
      const run = createActions({ session, scenario: expandScenarios().find((s) => s.id === SCENARIO), manifest: app.fixture, t: session.t });
      await run({ do: "expandToolRows", tools: [c.name], limit: 1 });
      await settle(session, { label: `open ${c.name}` });
      const state = await session.page.evaluate(
        ({ name }) => {
          const row = [...document.querySelectorAll("[data-message-uuid] [data-tool-row]")].find((el) => (el.textContent ?? "").includes(name));
          const detail = row?.closest("[data-tool-row-wrapper]")?.querySelector("[data-tool-detail]:not([hidden])");
          return {
            body: (document.body.innerText ?? "").slice(0, 400),
            transcript: document.querySelectorAll("[data-message-uuid]").length,
            detail: detail ? (detail.textContent ?? "") : null,
          };
        },
        { name: c.name },
      );
      expect(state.body, "the app is not replaced by its error screen").not.toContain(session.t("error.unexpectedError"));
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
      expect(state.transcript, "the transcript is still rendered").toBeGreaterThan(0);
      expect(state.detail, "the row opened").not.toBeNull();
      for (const piece of c.json) expect(state.detail, "the recorded input as JSON").toContain(piece);
    } finally {
      await session.close();
    }
  }, 120_000);
});
