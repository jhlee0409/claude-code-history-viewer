// DetailZone caption lines never overflow (review round 1, F1).
//
// A zone's first line holds its label ("Input" / "입력") and optional meta:
// the JSON fallback's recorded keys, Agent's stats. A long unbroken key (an
// ordinary snake_case input key) used to keep its full width as a flex item
// and run past the row at 390 px (ko 125 %: detail scrollWidth 387 > 370).
// The line must wrap instead: the label stays whole, the meta moves under it
// and breaks inside a key when nothing else fits — never clipped, never
// truncated (every key stays readable).
//
// Planted records (in this file's own fixture copy of the `unknown-outcome`
// session, real server + WebKit): a generic/MCP call whose input has many
// long keys (the Input label line's meta), and a `todowrite` whose input
// carries long extra keys (its "Other recorded fields (keys)" caption). Plus
// the Agent row of `transcript-agent-open` (stats on the Result line). At
// 390x844 en, 390x844 ko font scale 125 % and 1440x900 en. For every opened
// zone: its label line's scrollWidth <= clientWidth, every piece of the line
// inside the row box, the detail's scrollWidth <= clientWidth, and the keys
// all present in the line's text. Probes wait with the harness `settle()`.
// Skipped without WebKit or a built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "zoneCaptionFit.test" }).enabled;

const LONG_KEYS = {
  include_additional_metadata_for_nested_results: "recorded value",
  other: "another value",
  maximum_concurrent_background_requests_per_worker_pool: 8,
  fallbackRepositoryCredentialsHelperExecutablePath: "/usr/local/bin/helper",
};
const MCP_NAME = "mcp__probe__caption";
// Lower case (OpenCode's name, same body): upper-case TodoWrite is grouped as a task operation, not a ToolRow.
const TODO_NAME = "todowrite";
const TODO_EXTRA = {
  persist_the_reordered_list_across_every_connected_client_session: true,
  originatingConversationTurnIdentifier: "turn-0042",
};

const SCENARIO_PLANTED = "transcript-unknown-outcome";
const SCENARIO_AGENT = "transcript-agent-open";

const CONFIGS = [
  { label: "390x844 en", size: "390x844", locale: "en", variant: {} },
  { label: "390x844 ko, font scale 125%", size: "390x844", locale: "ko", variant: { fontScale: 1.25 } },
  { label: "1440x900 en", size: "1440x900", locale: "en", variant: {} },
];

let app;
let browser;

/** Replace the `unknown-outcome` session with the user's question + the planted calls and their results. */
function plant(fixture) {
  const project = fixture.projects.find((p) => p.name === "kiln-renderers");
  const session = project.sessions.find((s) => s.title === fixture.namedSessions["unknown-outcome"].title);
  const old = fs.readFileSync(session.filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const question = old.find((r) => r.type === "user" && typeof r.message?.content === "string");
  const use = old.find((r) => r.type === "assistant" && r.message.content.some((b) => b.type === "tool_use"));
  const result = old.find((r) => r.type === "user" && Object.hasOwn(r, "toolUseResult"));
  const calls = [
    [MCP_NAME, LONG_KEYS],
    [TODO_NAME, { todos: [{ content: "Wrap long captions", status: "in_progress", activeForm: "Wrapping long captions" }], ...TODO_EXTRA }],
  ];
  const records = [question];
  calls.forEach(([name, input], i) => {
    const a = structuredClone(use);
    a.uuid = `fit-a-${i}`;
    a.message.id = `fit-msg-${i}`;
    a.message.content = [{ type: "tool_use", id: `toolu_fit_${i}`, name, input }];
    const r = structuredClone(result);
    r.uuid = `fit-r-${i}`;
    r.parentUuid = a.uuid;
    delete r.toolUseResult;
    r.message = { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_fit_${i}`, content: "probe result" }] };
    records.push(a, r);
  });
  fs.writeFileSync(session.filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("zone-caption-fit");
  plant(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Every opened row: its zones' label lines and the "Other recorded fields" captions, with their geometry. */
const measure = (page) =>
  page.evaluate(() => {
    const rect = (r) => ({ left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) });
    const box = (el) => ({ rect: rect(el.getBoundingClientRect()), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent ?? "").replace(/\u2060/g, "") });
    return [...document.querySelectorAll("[data-message-uuid] [data-tool-row-wrapper]")]
      .map((wrapper) => {
        const detail = wrapper.querySelector(":scope > [data-tool-detail]:not([hidden])");
        if (!detail) return null;
        const pieces = (line) => [...line.querySelectorAll("*")].filter((el) => getComputedStyle(el).display !== "none").map((el) => rect(el.getBoundingClientRect()));
        return {
          verb: (wrapper.querySelector("[data-tool-verb]")?.textContent ?? "").trim(),
          row: rect(wrapper.getBoundingClientRect()),
          detail: { scrollWidth: detail.scrollWidth, clientWidth: detail.clientWidth },
          lines: [...detail.querySelectorAll("[data-detail-zone] > [data-zone-label]")].map((line) => ({ ...box(line), pieces: pieces(line) })),
          captions: [...detail.querySelectorAll("[data-input-json='rest'] > :first-child:not([data-output])")]
            .filter((el) => el.tagName !== "PRE")
            .map((el) => ({ ...box(el), pieces: pieces(el) })),
        };
      })
      .filter(Boolean);
  });

const inside = (r, b) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5;

function expectFits(row) {
  const detail = JSON.stringify(row);
  expect(row.detail.scrollWidth, `the detail does not scroll sideways: ${detail}`).toBeLessThanOrEqual(row.detail.clientWidth);
  for (const line of [...row.lines, ...row.captions]) {
    expect(line.scrollWidth, `caption line overflows: ${detail}`).toBeLessThanOrEqual(line.clientWidth);
    expect(inside(line.rect, row.row), `caption line leaves the row: ${detail}`).toBe(true);
    for (const piece of line.pieces) expect(inside(piece, row.row), `a caption piece leaves the row: ${detail}`).toBe(true);
  }
}

describe.skipIf(!ENABLED)("DetailZone caption lines wrap and never overflow (real WebKit)", () => {
  describe.each(CONFIGS)("$label", (config) => {
    let planted = [];
    let agent = [];

    beforeAll(async () => {
      const id = `${SCENARIO_PLANTED}--${config.size}--dark`;
      const session = await openScenario(browser, app, id, { locale: config.locale, variant: config.variant });
      try {
        // Tall enough to hold both opened rows (only the height changes).
        await session.page.setViewportSize({ width: Number(config.size.split("x")[0]), height: 2400 });
        await settle(session, { label: "tall" });
        const run = createActions({ session, scenario: expandScenarios().find((s) => s.id === id), manifest: app.fixture, t: session.t });
        await run({ do: "expandToolRows", match: [MCP_NAME, TODO_NAME], limit: 2 });
        await settle(session, { label: "opened" });
        planted = await measure(session.page);
      } finally {
        await session.close();
      }
      const agentSession = await openScenario(browser, app, `${SCENARIO_AGENT}--${config.size}--dark`, { locale: config.locale, variant: config.variant });
      try {
        await agentSession.page.setViewportSize({ width: Number(config.size.split("x")[0]), height: 2400 });
        await settle(agentSession, { label: "tall agent" });
        agent = await measure(agentSession.page);
      } finally {
        await agentSession.close();
      }
    }, 240_000);

    it("the generic call's Input label line (its recorded keys) wraps inside the row; every key stays readable", () => {
      const row = planted.find((r) => r.verb === MCP_NAME);
      expect(row, `opened ${MCP_NAME}: ${JSON.stringify(planted.map((r) => r.verb))}`).toBeTruthy();
      const keysLine = row.lines.find((l) => Object.keys(LONG_KEYS).every((k) => l.text.includes(k)));
      expect(keysLine, `the label line names every key: ${JSON.stringify(row.lines)}`).toBeTruthy();
      expectFits(row);
    });

    it("TodoWrite's \"Other recorded fields (keys)\" caption wraps inside the row", () => {
      const row = planted.find((r) => r.verb === TODO_NAME);
      expect(row, `opened ${TODO_NAME}: ${JSON.stringify(planted.map((r) => r.verb))}`).toBeTruthy();
      expect(row.captions.length, `the caption: ${JSON.stringify(row)}`).toBeGreaterThan(0);
      expect(row.captions.some((c) => Object.keys(TODO_EXTRA).every((k) => c.text.includes(k))), `names every extra key: ${JSON.stringify(row.captions)}`).toBe(true);
      expectFits(row);
    });

    it("Agent's Result line (its stats) stays inside the row", () => {
      const row = agent.find((r) => r.lines.length > 0);
      expect(row, `an opened Agent row: ${JSON.stringify(agent.map((r) => r.verb))}`).toBeTruthy();
      expectFits(row);
    });
  });
});
