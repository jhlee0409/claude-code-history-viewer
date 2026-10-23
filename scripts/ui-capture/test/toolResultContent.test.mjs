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
// extra-key objects and drops the exit code. Skipped without WebKit or a
// built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
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
  fs.writeFileSync(session.filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

async function openRows(session, targets) {
  const { page } = session;
  for (const target of targets) {
    await page.locator(`[data-tool-row] button[aria-expanded="false"]`, { hasText: target }).first().click();
  }
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
});
