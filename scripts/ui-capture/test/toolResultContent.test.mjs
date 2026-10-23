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
// recorded" and the Read as "No output". Skipped without WebKit or a built
// server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "toolResultContent.test" }).enabled;

const SCENARIO_ID = "transcript-unknown-outcome--1440x900--light";
const READ_ID = "toolu_review_fallback_read";

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
  fs.writeFileSync(session.filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
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
});
