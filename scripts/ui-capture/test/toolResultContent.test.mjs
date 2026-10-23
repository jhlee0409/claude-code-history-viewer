// A tool result's own evidence reaches the opened row, end to end
// (PR #728 review F1 / F2): real server (HTTP, both message endpoints) and
// real WebKit, adapted from the independent review's probe.
//
// The E15 session's fixture copy (owned by this file) gets two raw shapes
// the #727 contract emits:
//  - F2: the Bash result already carries its own inline `toolUseResult`
//    (exit code 2, stdout INLINE_FAILED) and its record holds a different
//    outer payload, which the backend keeps in an `unassigned` envelope. The
//    row must judge the inline evidence and never show the outer payload.
//  - F1: a Read whose content is a document block and an unknown block,
//    with empty stream metadata (`{stdout:"", stderr:""}`). Opened, both
//    blocks must show; "No output" must not replace them.
// Red: 5a6d6fa1 renders the Bash row as unknown with "No exit code
// recorded" and the Read as "No output".
//
// Round 2 (review R2-F1/F2/F3) adds, each as its own call:
//  - a Read whose content is text / document / text: opened, the three
//    parts keep their recorded order;
//  - a Read whose content nests a stream record two `result` levels deep
//    (the normalizer reads one): the recorded value stays visible;
//  - a Read whose content object has an extra key beside empty streams;
//  - a Bash whose content is only a document and whose own metadata records
//    exit code 0: opened, the document and "Exit code 0" both show, once.
// Red: a3b41fd4 reorders the parts, shows "No output" for the deep and the
// extra-key objects and drops the exit code.
//
// Round 3 (review R3-F1/F2, renderer audit TC7/TC8/TC13) adds:
//  - Bash results whose stdout has text and whose content holds distinct
//    text around a document (all of it stays, stdout first), or the stdout
//    text again plus a different tail (the copy is left out, the tail stays);
//  - an interrupted Bash with error_code and exit code 2 (both kept) and the
//    fixture's interrupted e2e shape (its sentence stays beside stdout);
//  - a Grep in content mode with a long match line: at 390 px / ko / 125 %
//    each match stays one line in a well that scrolls sideways;
//  - a short and a long Bash command: at 1440 and at 390 / ko / 125 % the
//    opened detail repeats the command in a well iff the row's target is cut.
// Red: c1bc12c1 drops the distinct text and the interrupted sentence, loses
// INTERRUPT_ERROR, soft-wraps the match line and always draws the well.
// Skipped without WebKit or a built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "toolResultContent.test" }).enabled;

const SCENARIO_ID = "transcript-unknown-outcome--1440x900--light";
const READ_ID = "toolu_review_fallback_read";
const DOC = { type: "document", title: "MIDDLE_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "DOC_BODY" } };
/** Round-2 shapes: [id, tool, input, content, record toolUseResult]. */
const ROUND2 = [
  ["interleaved", "Read", { file_path: "probe-interleaved.dat" }, [{ type: "text", text: "BEFORE_TEXT" }, DOC, { type: "text", text: "AFTER_TEXT" }], undefined],
  ["deep", "Read", { file_path: "probe-deep.dat" }, { result: { result: { stdout: "DEEP_RECORDED_VALUE" } } }, undefined],
  ["extra", "Read", { file_path: "probe-extra.dat" }, { stdout: "", stderr: "", marker: "EXTRA_RECORDED_VALUE" }, undefined],
  ["zero", "Bash", { command: "probe-zero-nontext" }, [DOC], { exitCode: 0, stdout: "", stderr: "" }],
];

const LONG_COMMAND = "pnpm exec vitest run src/components/transcript scripts/ui-capture/test --reporter=verbose --coverage.enabled=true";
const GREP_LINE = "/Users/dev/work/kiln/src/components/transcript/InteractionCard.tsx:48:      className=\"flex min-w-0 items-center gap-2 rounded-row px-1 text-left hover:bg-surface-hover\"";
/** Round-3 shapes: [id, tool, input, content, record toolUseResult, block extras]. */
const ROUND3 = [
  ["mixed-stream", "Bash", { command: "probe-mixed-stream" }, [{ type: "text", text: "BEFORE_DISTINCT" }, DOC, { type: "text", text: "AFTER_DISTINCT" }], { stdout: "STREAM_FIRST", stderr: "" }],
  ["mixed-dedup", "Bash", { command: "probe-mixed-dedup" }, [{ type: "text", text: "STREAM_SAME" }, DOC, { type: "text", text: "DIFFERENT_TAIL" }], { stdout: "STREAM_SAME" }],
  ["interrupt-error", "Bash", { command: "probe-interrupt-error" }, "", { interrupted: true, error_code: "INTERRUPT_ERROR", exitCode: 2 }],
  ["interrupt-sentence", "Bash", { command: "probe-interrupt-sentence" }, "[Request interrupted by user for tool use]", { stdout: "Running 48 tests using 4 workers", stderr: "", interrupted: true, isImage: false, exitCode: 130 }, { is_error: true }],
  ["grep-content", "Grep", { pattern: "probe-grep-content", output_mode: "content" }, `${GREP_LINE}\nsrc/b.ts:2:y`, undefined],
  ["short", "Bash", { command: "probe-short" }, "ok", { stdout: "ok", stderr: "", exitCode: 0 }],
  ["long", "Bash", { command: LONG_COMMAND }, "ok", { stdout: "ok", stderr: "", exitCode: 0 }],
];

let app;
let browser;
let sessionPath;

function addReviewShapes(fixture) {
  const project = fixture.projects.find((p) => p.name === "kiln-renderers");
  const session = project.sessions.find((s) => s.title === fixture.namedSessions["unknown-outcome"].title);
  sessionPath = session.filePath;
  const records = fs
    .readFileSync(session.filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const raw = records.find((r) => r.type === "user" && Object.hasOwn(r, "toolUseResult"));
  const inline = raw.message.content.find((b) => b.type === "tool_result");
  raw.toolUseResult = { exitCode: 0, stdout: "OUTER_UNASSIGNED_DO_NOT_USE" };
  inline.content = "INLINE_CONTENT";
  inline.toolUseResult = { exitCode: 2, stdout: "INLINE_FAILED", stderr: "" };
  const assistant = records.find((r) => r.type === "assistant" && r.message.content.some((b) => b.type === "tool_use"));
  assistant.message.content.push({ type: "tool_use", id: READ_ID, name: "Read", input: { file_path: "probe.dat" } });
  records.push({
    uuid: "review-fallback-result",
    sessionId: raw.sessionId,
    type: "user",
    timestamp: "2026-06-19T07:40:00Z",
    toolUseResult: { stdout: "", stderr: "" },
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: READ_ID,
          content: [
            { type: "document", title: "PRESERVE_ME_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "DOCUMENT_BODY" } },
            { type: "novel-type", marker: "PRESERVE_ME_UNKNOWN" },
          ],
        },
      ],
    },
  });
  for (const [id, name, input, content, toolUseResult] of ROUND2) {
    assistant.message.content.push({ type: "tool_use", id: `toolu_r2_${id}`, name, input });
    records.push({
      uuid: `review-r2-${id}`,
      sessionId: raw.sessionId,
      type: "user",
      timestamp: "2026-06-19T07:41:00Z",
      ...(toolUseResult ? { toolUseResult } : {}),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_r2_${id}`, content }] },
    });
  }
  for (const [id, name, input, content, toolUseResult, extras] of ROUND3) {
    assistant.message.content.push({ type: "tool_use", id: `toolu_r3_${id}`, name, input });
    records.push({
      uuid: `review-r3-${id}`,
      sessionId: raw.sessionId,
      type: "user",
      timestamp: "2026-06-19T07:42:00Z",
      ...(toolUseResult ? { toolUseResult } : {}),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_r3_${id}`, content, ...(extras ?? {}) }] },
    });
  }
  fs.writeFileSync(session.filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

/**
 * Open the rows whose text holds each target, one by one, through the
 * harness's own step (scroll into view, click, park the pointer, wait for the
 * virtual list to settle): a bare click can land on the next message while
 * the list re-measures an opened row.
 */
async function openRows(session, targets, scenarioId = SCENARIO_ID) {
  const { page } = session;
  const scenario = expandScenarios().find((s) => s.id === scenarioId);
  const run = createActions({ session, scenario, manifest: app.fixture, t: session.t });
  for (const target of targets) await run({ do: "expandToolRows", match: [target], limit: 1 });
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-tool-row-wrapper]")).map((el) => ({
      text: el.innerText,
      verdict: el.querySelector("[data-tool-row]")?.getAttribute("data-tool-verdict"),
      detailMeta: el.querySelector("[data-tool-detail] > [data-meta]")?.innerText ?? "",
    })),
  );
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("tool-result-content");
  addReviewShapes(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe.skipIf(!ENABLED)("a result's own evidence reaches the opened row (real server, WebKit)", () => {
  it.each(["load_provider_messages", "load_provider_messages_paginated"])("%s keeps the inline field and the unassigned outer payload apart", async (command) => {
    const response = await fetch(`${app.server.origin}/api/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "claude", sessionPath, offset: 0, limit: 100 }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    const messages = Array.isArray(data) ? data : data.messages;
    const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
    const bash = results.find((b) => b.content === "INLINE_CONTENT");
    expect(bash.toolUseResult).toEqual({ exitCode: 2, stdout: "INLINE_FAILED", stderr: "" });
    expect(bash.toolUseResultSource.association).toBe("unassigned");
    expect(bash.toolUseResultSource.unassignedToolUseResult).toEqual({ exitCode: 0, stdout: "OUTER_UNASSIGNED_DO_NOT_USE" });
    const read = results.find((b) => b.tool_use_id === READ_ID);
    expect(read.toolUseResult).toEqual({ stdout: "", stderr: "" });
    expect(read.toolUseResultSource.association).toBe("single_result");
    expect(read.content.map((b) => b.type)).toEqual(["document", "novel-type"]);
  });

  it("opened: Bash fails on its own exit code 2, the Read keeps both content blocks", async () => {
    const session = await openScenario(browser, app, SCENARIO_ID, { locale: "en" });
    try {
      const { t, page } = session;
      for (const target of ["git status", "probe.dat"]) {
        await page.locator(`[data-tool-row] button[aria-expanded="false"]`, { hasText: target }).first().click();
      }
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-tool-row-wrapper]")).map((el) => ({
          text: el.innerText,
          verdict: el.querySelector("[data-tool-row]")?.getAttribute("data-tool-verdict"),
        })),
      );
      const bash = rows.find((r) => r.text.includes("git status"));
      const read = rows.find((r) => r.text.includes("probe.dat"));
      expect(bash, JSON.stringify(rows)).toBeDefined();
      expect(read, JSON.stringify(rows)).toBeDefined();

      expect(bash.verdict).toBe("failed");
      expect(bash.text).toContain(t("toolOutcome.failedExitCode").replace("{{code}}", "2"));
      expect(bash.text).toContain("INLINE_FAILED");
      expect(bash.text).not.toContain("OUTER_UNASSIGNED_DO_NOT_USE");
      expect(bash.text).not.toContain(t("toolOutcome.notVerifiedNoExitCode"));

      expect(read.text).toContain("PRESERVE_ME_DOCUMENT");
      expect(read.text).toContain("PRESERVE_ME_UNKNOWN");
      expect(read.text).not.toContain(t("outputBlock.empty"));
    } finally {
      await session.close();
    }
  }, 120_000);

  it.each(["load_provider_messages", "load_provider_messages_paginated"])("%s delivers the round-2 shapes as recorded", async (command) => {
    const response = await fetch(`${app.server.origin}/api/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "claude", sessionPath, offset: 0, limit: 100 }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    const messages = Array.isArray(data) ? data : data.messages;
    const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
    for (const [id, , , content, toolUseResult] of ROUND2) {
      const block = results.find((b) => b.tool_use_id === `toolu_r2_${id}`);
      expect(block, id).toBeDefined();
      expect(block.content, id).toEqual(content);
      if (toolUseResult) expect(block.toolUseResult, id).toEqual(toolUseResult);
    }
  });

  it("opened: parts keep their order, deep / extra-key content stays, exit code 0 shows once", async () => {
    const session = await openScenario(browser, app, SCENARIO_ID, { locale: "en" });
    try {
      const { t } = session;
      const rows = await openRows(session, ["probe-interleaved.dat", "probe-deep.dat", "probe-extra.dat", "probe-zero-nontext"]);
      const row = (target) => {
        const found = rows.find((r) => r.text.includes(target));
        expect(found, `${target}: ${JSON.stringify(rows)}`).toBeDefined();
        return found;
      };
      const empty = t("outputBlock.empty");

      const interleaved = row("probe-interleaved.dat").text;
      const order = ["BEFORE_TEXT", "MIDDLE_DOCUMENT", "AFTER_TEXT"].map((m) => interleaved.indexOf(m));
      expect(order[0], interleaved).toBeGreaterThanOrEqual(0);
      expect(order[0], interleaved).toBeLessThan(order[1]);
      expect(order[1], interleaved).toBeLessThan(order[2]);

      const deep = row("probe-deep.dat").text;
      expect(deep).toContain("DEEP_RECORDED_VALUE");
      expect(deep).not.toContain(empty);

      const extra = row("probe-extra.dat").text;
      expect(extra).toContain("EXTRA_RECORDED_VALUE");
      expect(extra).not.toContain(empty);

      const zero = row("probe-zero-nontext");
      const exitZero = t("toolOutcome.exitCode").replace("{{code}}", "0");
      expect(zero.verdict).toBe("succeeded");
      expect(zero.text).toContain("MIDDLE_DOCUMENT");
      expect(zero.detailMeta).toContain(exitZero);
      expect(zero.text.split(exitZero).length - 1, zero.text).toBe(1);
    } finally {
      await session.close();
    }
  }, 120_000);
  it.each(["load_provider_messages", "load_provider_messages_paginated"])("%s delivers the round-3 shapes as recorded", async (command) => {
    const response = await fetch(`${app.server.origin}/api/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "claude", sessionPath, offset: 0, limit: 100 }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    const messages = Array.isArray(data) ? data : data.messages;
    const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
    for (const [id, , , content, toolUseResult] of ROUND3) {
      const block = results.find((b) => b.tool_use_id === `toolu_r3_${id}`);
      expect(block, id).toBeDefined();
      expect(block.content, id).toEqual(content);
      if (toolUseResult) expect(block.toolUseResult, id).toEqual(toolUseResult);
    }
  });

  it("opened: distinct text beside stdout stays in order, identical text once, interruption keeps its error code and sentence", async () => {
    const session = await openScenario(browser, app, SCENARIO_ID, { locale: "en" });
    try {
      const { t } = session;
      const rows = await openRows(session, ["probe-mixed-stream", "probe-mixed-dedup", "probe-interrupt-error", "probe-interrupt-sentence"]);
      const row = (target) => {
        const found = rows.find((r) => r.text.includes(target));
        expect(found, `${target}: ${JSON.stringify(rows)}`).toBeDefined();
        return found;
      };
      const count = (text, word) => text.split(word).length - 1;

      const mixed = row("probe-mixed-stream").text;
      const order = ["STREAM_FIRST", "BEFORE_DISTINCT", "MIDDLE_DOCUMENT", "AFTER_DISTINCT"].map((m) => mixed.indexOf(m));
      expect(order[0], mixed).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < order.length; i += 1) expect(order[i - 1], mixed).toBeLessThan(order[i]);

      const dedup = row("probe-mixed-dedup").text;
      expect(count(dedup, "STREAM_SAME"), dedup).toBe(1);
      expect(dedup).toContain("DIFFERENT_TAIL");

      const interruptError = row("probe-interrupt-error");
      expect(count(interruptError.text, "INTERRUPT_ERROR"), interruptError.text).toBe(1);
      expect(interruptError.detailMeta).toContain("INTERRUPT_ERROR");
      expect(interruptError.detailMeta).toContain(t("toolOutcome.exitCode").replace("{{code}}", "2"));
      expect(count(interruptError.text, t("toolOutcome.interrupted")), interruptError.text).toBe(1);

      const sentence = row("probe-interrupt-sentence").text;
      const [stream, said] = ["Running 48 tests using 4 workers", "[Request interrupted by user for tool use]"].map((m) => sentence.indexOf(m));
      expect(stream, sentence).toBeGreaterThanOrEqual(0);
      expect(stream, sentence).toBeLessThan(said);
    } finally {
      await session.close();
    }
  }, 120_000);

  /** For every opened row with a code target: is the target cut, and does the detail repeat it whole? */
  const targetWells = (page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-tool-row-wrapper]"))
        .filter((el) => el.querySelector("[data-tool-row] button[aria-expanded='true']"))
        .map((el) => {
          const code = el.querySelector("[data-tool-row] code[title]");
          if (!code) return null;
          const full = code.getAttribute("title");
          const wells = Array.from(el.querySelectorAll("[data-tool-detail] pre")).filter((pre) => pre.textContent === full);
          return {
            full,
            shown: code.textContent,
            scrollWidth: code.scrollWidth,
            clientWidth: code.clientWidth,
            cut: code.scrollWidth > code.clientWidth || code.textContent !== full,
            wells: wells.length,
          };
        })
        .filter(Boolean),
    );

  it.each([
    ["1440, en", "transcript-unknown-outcome--1440x900--light", "en", {}],
    ["390, ko, 125%", "transcript-unknown-outcome--390x844--dark", "ko", { fontScale: 1.25 }],
  ])("TC8 at %s: the opened detail repeats the command in a well iff the row's target is cut", async (_label, scenario, locale, variant) => {
    const session = await openScenario(browser, app, scenario, { locale, variant });
    try {
      await openRows(session, ["probe-short", LONG_COMMAND.slice(0, 24)], scenario);
      const rows = await targetWells(session.page);
      const detail = JSON.stringify(rows);
      const probes = rows.filter((r) => r.full === "probe-short" || r.full === LONG_COMMAND);
      expect(probes, detail).toHaveLength(2);
      for (const r of probes) expect(r.wells, `${r.full}: ${detail}`).toBe(r.cut ? 1 : 0);
      expect(probes.find((r) => r.full === LONG_COMMAND).cut, detail).toBe(true);
      if (scenario.includes("1440")) expect(probes.find((r) => r.full === "probe-short").cut, detail).toBe(false);
    } finally {
      await session.close();
    }
  }, 120_000);

  it("TC13 at 390, ko, 125%: each Grep content-mode match stays one line in a well that scrolls sideways", async () => {
    const session = await openScenario(browser, app, "transcript-unknown-outcome--390x844--dark", { locale: "ko", variant: { fontScale: 1.25 } });
    try {
      await openRows(session, ["probe-grep-content"], "transcript-unknown-outcome--390x844--dark");
      const m = await session.page.evaluate((line) => {
        const pre = Array.from(document.querySelectorAll("[data-tool-detail] pre[data-output-text]")).find((el) => (el.textContent ?? "").startsWith(line));
        if (!pre) return null;
        const wrapper = pre.closest("[data-tool-row-wrapper]");
        const range = document.createRange();
        range.selectNodeContents(pre);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 1 && r.height > 0).map((r) => Math.round(r.top)));
        return {
          whiteSpace: getComputedStyle(pre).whiteSpace,
          lineCount: (pre.textContent ?? "").split("\n").length,
          visualLines: tops.size,
          scrollWidth: pre.scrollWidth,
          clientWidth: pre.clientWidth,
          preRight: pre.getBoundingClientRect().right,
          wrapperRight: wrapper.getBoundingClientRect().right,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
        };
      }, GREP_LINE);
      expect(m, "the Grep content-mode output well").not.toBeNull();
      const detail = JSON.stringify(m);
      expect(m.rootFontSize, detail).toBe("20px");
      expect(m.whiteSpace, detail).toBe("pre");
      expect(m.visualLines, detail).toBe(m.lineCount);
      expect(m.scrollWidth, `the long match scrolls inside the well: ${detail}`).toBeGreaterThan(m.clientWidth);
      expect(m.preRight, detail).toBeLessThanOrEqual(m.wrapperRight + 0.5);
      expect(m.pageOverflow, detail).toBeLessThanOrEqual(0);
    } finally {
      await session.close();
    }
  }, 120_000);
});
