import { describe, it, expect, beforeEach } from "vitest";
import { linearSearchMessages, isSearchIndexReady, clearSearchIndex } from "./searchIndex";
import type { ClaudeMessage } from "../types";

// Helper to create minimal ClaudeMessage fixtures
function createMessage(overrides: Partial<ClaudeMessage> & { uuid: string; type: string }): ClaudeMessage {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    content: "",
    ...overrides,
  } as ClaudeMessage;
}

describe("linearSearchMessages", () => {
  const messages: ClaudeMessage[] = [
    createMessage({ uuid: "msg-1", type: "user", content: "Hello world" }),
    createMessage({ uuid: "msg-2", type: "assistant", content: "Hi there! How can I help you today?" }),
    createMessage({ uuid: "msg-3", type: "user", content: "Find the bug in my code" }),
    createMessage({ uuid: "msg-4", type: "assistant", content: "I found the bug. The bug was in line 42." }),
    createMessage({ uuid: "msg-5", type: "system", content: "Session started" }),
  ];

  it("returns empty array for empty query", () => {
    expect(linearSearchMessages(messages, "")).toEqual([]);
    expect(linearSearchMessages(messages, "   ")).toEqual([]);
  });

  it("finds matches case-insensitively", () => {
    const results = linearSearchMessages(messages, "hello");
    expect(results.length).toBe(1);
    expect(results[0].messageUuid).toBe("msg-1");
    expect(results[0].messageIndex).toBe(0);
  });

  it("finds multiple matches within same message", () => {
    const results = linearSearchMessages(messages, "bug");
    // "bug" appears twice in msg-4: "found the bug" and "The bug was"
    // Sorted newest-first with descending matchIndex, so matchIndex 1 comes first
    const msg4Results = results.filter(r => r.messageUuid === "msg-4");
    expect(msg4Results.length).toBe(2);
    expect(msg4Results[1].matchIndex).toBe(0);
    expect(msg4Results[1].matchCount).toBe(2);
    expect(msg4Results[0].matchIndex).toBe(1);
    expect(msg4Results[0].matchCount).toBe(2);
  });

  it("finds matches across multiple messages", () => {
    const results = linearSearchMessages(messages, "the");
    // "the" in msg-3 ("the bug") and msg-4 ("the bug. The bug")
    expect(results.length).toBeGreaterThan(1);
    const uuids = new Set(results.map(r => r.messageUuid));
    expect(uuids.size).toBeGreaterThan(1);
  });

  it("returns empty array when no matches found", () => {
    const results = linearSearchMessages(messages, "nonexistent_xyz");
    expect(results.length).toBe(0);
  });

  it("handles empty messages array", () => {
    const results = linearSearchMessages([], "hello");
    expect(results.length).toBe(0);
  });

  it("searches array content fields", () => {
    const msgWithArray = createMessage({
      uuid: "msg-array",
      type: "assistant",
      content: [{ type: "text", text: "function calculateTotal()" }],
    });
    const results = linearSearchMessages([msgWithArray], "calculateTotal");
    expect(results.length).toBe(1);
    expect(results[0].messageUuid).toBe("msg-array");
  });

  it("searches toolUseResult content", () => {
    const msgWithTool = createMessage({
      uuid: "msg-tool",
      type: "user",
      content: "",
      toolUseResult: { content: "Error: file not found", stdout: "" },
    });
    const results = linearSearchMessages([msgWithTool], "file not found");
    expect(results.length).toBe(1);
    expect(results[0].messageUuid).toBe("msg-tool");
  });

  it("supports toolId filter type", () => {
    const msgWithToolUse = createMessage({
      uuid: "msg-tid",
      type: "assistant",
      content: [{ type: "tool_use", id: "toolu_abc123", name: "read_file" }],
    });
    const results = linearSearchMessages([msgWithToolUse], "toolu_abc123", "toolId");
    expect(results.length).toBe(1);
    expect(results[0].messageUuid).toBe("msg-tid");
  });

  it("returns results newest-first (descending messageIndex)", () => {
    // msg-1 (oldest, index 0) has "hello", msg-4 (newest, index 3) has "bug"
    // Searching for "bug" should return msg-4 before msg-1
    const results = linearSearchMessages(messages, "bug");
    expect(results.length).toBe(3); // msg-3 has 1, msg-4 has 2 = 3 total
    // The result at index 0 should be from msg-4 (latest message with matches)
    expect(results[0].messageUuid).toBe("msg-4");
    // Results should be in descending messageIndex order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].messageIndex).toBeLessThanOrEqual(results[i - 1].messageIndex);
    }
  });

  it("finds mid-word substrings that FlexSearch forward tokenize would miss", () => {
    // FlexSearch "forward" tokenize only matches at word boundaries.
    // Searching for "orld" in "Hello world" — "forward" misses it because
    // "world" tokenizes to ["w","wo","wor","worl","world"].  "orld" starts
    // with "o", not "w", so it's not a prefix of any "world" token.
    // The linear fallback (indexOf) correctly finds it as a substring.
    const msg = createMessage({
      uuid: "msg-mid",
      type: "user",
      content: "Hello world and a big debugging session",
    });
    const resultsMidWord = linearSearchMessages([msg], "orld");
    expect(resultsMidWord.length).toBe(1);
    expect(resultsMidWord[0].messageUuid).toBe("msg-mid");

    // Also verify "bug" embedded in "debugging" is found (forward tokenize
    // would miss this because "debugging" tokens don't include "bug").
    const resultsEmbedded = linearSearchMessages([msg], "bug");
    expect(resultsEmbedded.length).toBe(1);
    expect(resultsEmbedded[0].messageUuid).toBe("msg-mid");
  });
});

describe("tool_use input indexing (#429)", () => {
  it("finds text inside tool_use.input (file_path, command, etc.)", () => {
    const msg = createMessage({
      uuid: "tu-1",
      type: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/reflectance.ts" } },
      ],
    });
    // Searching for the tool name still works...
    expect(linearSearchMessages([msg], "Read").length).toBe(1);
    // ...and now the input value is searchable too (previously missed).
    const byInput = linearSearchMessages([msg], "reflectance");
    expect(byInput.length).toBe(1);
    expect(byInput[0].messageUuid).toBe("tu-1");
  });

  it("finds nested string values in tool_use.input", () => {
    const msg = createMessage({
      uuid: "tu-2",
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "AskUserQuestion",
          input: { questions: [{ question: "What reflectance model should we use?" }] },
        },
      ],
    });
    const results = linearSearchMessages([msg], "reflectance model");
    expect(results.length).toBe(1);
    expect(results[0].messageUuid).toBe("tu-2");
  });

  it("indexes mcp_tool_use input values", () => {
    const msg = createMessage({
      uuid: "tu-3",
      type: "assistant",
      content: [
        { type: "mcp_tool_use", server_name: "fs", tool_name: "grep", input: { pattern: "needle-token" } },
      ],
    });
    expect(linearSearchMessages([msg], "needle-token").length).toBe(1);
  });
});

describe("isSearchIndexReady / clearSearchIndex", () => {
  beforeEach(() => {
    clearSearchIndex();
  });

  it("returns false before any build", () => {
    expect(isSearchIndexReady()).toBe(false);
  });

  it("returns false after clear", () => {
    clearSearchIndex();
    expect(isSearchIndexReady()).toBe(false);
  });
});
