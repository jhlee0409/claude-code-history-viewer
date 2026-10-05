import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../types";
import { getFilteredClassifiedMessages } from "./classifiedRows";

const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage => ({
  uuid: "message",
  type: "user",
  role: "user",
  timestamp: "2026-09-26T06:29:32.477Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

describe("getFilteredClassifiedMessages", () => {
  it("returns an empty list for no messages", () => {
    expect(getFilteredClassifiedMessages([])).toEqual([]);
  });

  it("filters out noise types and empty messages", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({ uuid: "m1", content: "Scrub for pii" }),
      makeMessage({ uuid: "m2", type: "progress", data: { type: "agent_progress" } }),
      makeMessage({ uuid: "m3", type: "queue-operation", operation: "enqueue" }),
      makeMessage({ uuid: "m4", type: "file-history-snapshot" }),
      makeMessage({ uuid: "m5", content: "" }),
    ]);

    expect(rows.map((row) => row.message.uuid)).toEqual(["m1"]);
  });

  it("classifies each row and carries the raw message plus info", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({ uuid: "m1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "m2",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].info.kind).toBe("prompt");
    expect(rows[1].info.kind).toBe("reply");
    expect(rows[0].message.uuid).toBe("m1");
    expect(rows[1].message.uuid).toBe("m2");
  });

  it("numbers turnIndex sequentially over visible rows only, 1-based", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({ uuid: "m1", content: "First" }),
      makeMessage({ uuid: "m2", type: "progress", data: { type: "agent_progress" } }),
      makeMessage({ uuid: "m3", content: "Second" }),
    ]);

    expect(rows.map((row) => row.entry.turnIndex)).toEqual([1, 2]);
  });

  it("builds a preview, status, and hasToolUse on the entry", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({
        uuid: "m1",
        content: [
          { type: "text", text: "<task-notification><task-id>a</task-id><status>failed</status><summary>Task A failed</summary></task-notification>" },
        ],
      }),
    ]);

    expect(rows[0].entry.kind).toBe("agent-update");
    expect(rows[0].entry.preview).toBe("Task A failed");
    expect(rows[0].entry.status).toBe("failed");
  });

  it("truncates a long preview and strips xml tags from command text", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({
        uuid: "m1",
        content: "<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>",
      }),
    ]);

    expect(rows[0].entry.preview).toBe("/init");
  });

  it("marks hasToolUse true when the row carries a tool_use block", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({
        uuid: "m1",
        type: "assistant",
        role: "assistant",
        content: [
          { type: "text", text: "Scrubbing first." },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
        ],
      }),
    ]);

    expect(rows[0].entry.hasToolUse).toBe(true);
    expect(rows[0].entry.kind).toBe("reply");
  });
});
