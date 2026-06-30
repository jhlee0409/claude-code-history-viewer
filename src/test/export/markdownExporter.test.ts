import { describe, it, expect } from "vitest";
import { exportToMarkdown } from "@/services/export/markdownExporter";
import type { ClaudeMessage } from "@/types";

function makeMessage(overrides: Partial<ClaudeMessage> & { type: ClaudeMessage["type"] }): ClaudeMessage {
  return {
    uuid: "test-uuid",
    sessionId: "test-session",
    timestamp: "2026-03-13T10:30:15.000Z",
    content: "",
    ...overrides,
  } as ClaudeMessage;
}

describe("markdownExporter", () => {
  it("should format user message with bold role and timestamp", () => {
    const messages = [
      makeMessage({ type: "user", content: "Hello world" }),
    ];
    const result = exportToMarkdown(messages, "test-session");

    expect(result).toContain("**User**");
    expect(result).toContain("Hello world");
  });

  it("should format assistant message with bold role", () => {
    const messages = [
      makeMessage({ type: "assistant", content: "Hi there" }),
    ];
    const result = exportToMarkdown(messages, "test-session");

    expect(result).toContain("**Assistant**");
    expect(result).toContain("Hi there");
  });

  it("should include session header with name", () => {
    const messages = [
      makeMessage({ type: "user", content: "test" }),
    ];
    const result = exportToMarkdown(messages, "my-session");

    expect(result).toContain("# Session: my-session");
    expect(result).toContain("**Date**");
    expect(result).toContain("2026-03-13");
  });

  it("should include message count stats", () => {
    const messages = [
      makeMessage({ type: "user", content: "q1" }),
      makeMessage({ type: "assistant", content: "a1" }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("1 user / 1 assistant");
  });

  it("should exclude sidechain messages", () => {
    const messages = [
      makeMessage({ type: "user", content: "visible" }),
      makeMessage({ type: "user", content: "hidden", isSidechain: true }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("visible");
    expect(result).not.toContain("hidden");
  });

  it("should include sidechain messages when includeSidechain is set (subagent export, issue #433)", () => {
    // A subagent session: every message is a sidechain message.
    const messages = [
      makeMessage({ type: "user", content: "subagent question", isSidechain: true }),
      makeMessage({ type: "assistant", content: "subagent answer", isSidechain: true }),
    ];

    const withoutOption = exportToMarkdown(messages, "test");
    expect(withoutOption).toContain("0 user / 0 assistant");
    expect(withoutOption).not.toContain("subagent question");

    const withOption = exportToMarkdown(messages, "test", undefined, { includeSidechain: true });
    expect(withOption).toContain("1 user / 1 assistant");
    expect(withOption).toContain("subagent question");
    expect(withOption).toContain("subagent answer");
  });

  it("should exclude system and summary messages", () => {
    const messages = [
      makeMessage({ type: "user", content: "visible" }),
      makeMessage({ type: "system", content: "system msg" }),
      makeMessage({ type: "summary", content: "summary msg" }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("visible");
    expect(result).not.toContain("system msg");
    expect(result).not.toContain("summary msg");
  });

  it("should replace image content with placeholder", () => {
    const messages = [
      makeMessage({
        type: "assistant",
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
      }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("[Image]");
  });

  it("should summarize tool_use with input details", () => {
    const messages = [
      makeMessage({
        type: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/test.ts" } }],
      }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("Read(file_path: /test.ts)");
  });

  it("should extract text from ContentItem array", () => {
    const messages = [
      makeMessage({
        type: "assistant",
        content: [
          { type: "text", text: "First part" },
          { type: "text", text: "Second part" },
        ],
      }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("First part");
    expect(result).toContain("Second part");
  });

  it("should separate messages with dividers", () => {
    const messages = [
      makeMessage({ type: "user", content: "q1" }),
      makeMessage({ type: "assistant", content: "a1" }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result.match(/---/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("should render thinking in collapsible details block", () => {
    const messages = [
      makeMessage({
        type: "assistant",
        content: [{ type: "thinking", thinking: "Let me think about this..." }],
      }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("<details>");
    expect(result).toContain("Let me think about this...");
  });

  it("should show model name for assistant messages", () => {
    const messages = [
      makeMessage({
        type: "assistant",
        content: "response",
        model: "claude-opus-4-20250514",
      } as Partial<ClaudeMessage> & { type: "assistant" }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("claude-opus-4-20250514");
  });

  it("should show token usage for assistant messages", () => {
    const messages = [
      makeMessage({
        type: "assistant",
        content: "response",
        usage: { input_tokens: 1000, output_tokens: 500 },
      } as Partial<ClaudeMessage> & { type: "assistant" }),
    ];
    const result = exportToMarkdown(messages, "test");

    expect(result).toContain("in: 1,000");
    expect(result).toContain("out: 500");
  });
});
