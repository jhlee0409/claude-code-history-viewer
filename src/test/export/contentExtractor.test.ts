import { describe, it, expect } from "vitest";
import { extractBlocks, blocksToPlainText } from "@/services/export/contentExtractor";

describe("contentExtractor", () => {
  it("should return empty array for null/undefined", () => {
    expect(extractBlocks(null as unknown as undefined)).toEqual([]);
    expect(extractBlocks(undefined)).toEqual([]);
  });

  it("should wrap plain string as text block", () => {
    const blocks = extractBlocks("hello world");
    expect(blocks).toEqual([{ kind: "text", text: "hello world" }]);
  });

  it("should extract text content items", () => {
    const blocks = extractBlocks([
      { type: "text", text: "First" },
      { type: "text", text: "Second" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: "text", text: "First" });
  });

  it("should extract thinking as thinking kind", () => {
    const blocks = extractBlocks([
      { type: "thinking", thinking: "Let me think...", signature: "sig123" },
    ]);
    expect(blocks[0]).toEqual({ kind: "thinking", text: "Let me think..." });
  });

  it("should handle redacted thinking", () => {
    const blocks = extractBlocks([{ type: "redacted_thinking", data: "encrypted" }]);
    expect(blocks[0]).toEqual({ kind: "thinking", text: "[Redacted thinking]" });
  });

  it("should include tool_use input summary", () => {
    const blocks = extractBlocks([
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/main.ts" } },
    ]);
    expect(blocks[0]?.kind).toBe("tool");
    expect(blocks[0]?.text).toContain("Read");
    expect(blocks[0]?.text).toContain("file_path: /src/main.ts");
  });

  it("should truncate long tool input values", () => {
    const longValue = "x".repeat(200);
    const blocks = extractBlocks([
      { type: "tool_use", id: "t1", name: "Write", input: { content: longValue } },
    ]);
    expect(blocks[0]?.text).toContain("...");
    expect(blocks[0]!.text.length).toBeLessThan(200);
  });

  it("should handle tool_result with string content", () => {
    const blocks = extractBlocks([
      { type: "tool_result", tool_use_id: "t1", content: "File contents here" },
    ]);
    expect(blocks[0]).toEqual({ kind: "result", text: "File contents here" });
  });

  it("should handle tool_result errors", () => {
    const blocks = extractBlocks([
      { type: "tool_result", tool_use_id: "t1", content: "Not found", is_error: true },
    ]);
    expect(blocks[0]?.text).toContain("[Error]");
  });

  it("should handle image content", () => {
    const blocks = extractBlocks([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
    ]);
    expect(blocks[0]).toEqual({ kind: "media", text: "[Image]" });
  });

  it("should handle server_tool_use with input", () => {
    const blocks = extractBlocks([
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "tauri pdf" } },
    ]);
    expect(blocks[0]?.kind).toBe("tool");
    expect(blocks[0]?.text).toContain("web_search");
    expect(blocks[0]?.text).toContain("query: tauri pdf");
  });

  it("should handle web_search_tool_result with content array", () => {
    const blocks = extractBlocks([
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [
          { type: "web_search_result", title: "Tauri Docs", url: "https://tauri.app", encrypted_content: "..." },
          { type: "web_search_result", title: "MDN", url: "https://mdn.io", encrypted_content: "..." },
        ],
      },
    ]);
    expect(blocks[0]?.kind).toBe("search");
    expect(blocks[0]?.text).toContain("Tauri Docs");
    expect(blocks[0]?.text).toContain("MDN");
  });

  it("should handle web_fetch_tool_result with nested url", () => {
    const blocks = extractBlocks([
      {
        type: "web_fetch_tool_result",
        tool_use_id: "f1",
        content: { type: "web_fetch_result", url: "https://example.com" },
      },
    ]);
    expect(blocks[0]?.kind).toBe("search");
    expect(blocks[0]?.text).toContain("https://example.com");
  });

  it("should handle code_execution_tool_result with nested stdout", () => {
    const blocks = extractBlocks([
      {
        type: "code_execution_tool_result",
        tool_use_id: "c1",
        content: { type: "code_execution_result", stdout: "Hello World", stderr: "", return_code: 0 },
      },
    ]);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.text).toContain("Hello World");
  });

  it("should handle bash_code_execution_tool_result with stderr", () => {
    const blocks = extractBlocks([
      {
        type: "bash_code_execution_tool_result",
        tool_use_id: "b1",
        content: { type: "bash_code_execution_result", stdout: "", stderr: "command not found", return_code: 1 },
      },
    ]);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.text).toContain("[stderr]");
    expect(blocks[0]?.text).toContain("command not found");
  });

  it("should handle text_editor_code_execution_tool_result", () => {
    const blocks = extractBlocks([
      {
        type: "text_editor_code_execution_tool_result",
        tool_use_id: "e1",
        content: { type: "text_editor_code_execution_result", operation: "edit", path: "/src/index.ts", success: true },
      },
    ]);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.text).toContain("edit");
    expect(blocks[0]?.text).toContain("/src/index.ts");
  });

  it("should handle document with title", () => {
    const blocks = extractBlocks([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "..." }, title: "README.md" },
    ]);
    expect(blocks[0]).toEqual({ kind: "media", text: "[Document: README.md]" });
  });

  it("should handle mcp_tool_use with server_name and tool_name", () => {
    const blocks = extractBlocks([
      { type: "mcp_tool_use", id: "m1", server_name: "context7", tool_name: "query-docs", input: { query: "tauri" } },
    ]);
    expect(blocks[0]?.kind).toBe("tool");
    expect(blocks[0]?.text).toContain("context7.query-docs");
    expect(blocks[0]?.text).toContain("query: tauri");
  });

  it("should handle mcp_tool_result with text content", () => {
    const blocks = extractBlocks([
      {
        type: "mcp_tool_result",
        tool_use_id: "m1",
        content: { type: "text", text: "Documentation result" },
      },
    ]);
    expect(blocks[0]?.kind).toBe("result");
    expect(blocks[0]?.text).toContain("Documentation result");
  });

  it("should handle mcp_tool_result with error", () => {
    const blocks = extractBlocks([
      {
        type: "mcp_tool_result",
        tool_use_id: "m1",
        content: "Server unavailable",
        is_error: true,
      },
    ]);
    expect(blocks[0]?.kind).toBe("result");
    expect(blocks[0]?.text).toContain("[Error]");
    expect(blocks[0]?.text).toContain("Server unavailable");
  });

  it("should handle unknown types with type label", () => {
    const blocks = extractBlocks([{ type: "future_type" }]);
    expect(blocks[0]).toEqual({ kind: "text", text: "[future_type]" });
  });

  it("should convert blocks to plain text", () => {
    const blocks = [
      { kind: "text" as const, text: "Hello" },
      { kind: "tool" as const, text: "Read(file: test.ts)" },
    ];
    const text = blocksToPlainText(blocks);
    expect(text).toBe("Hello\n\nRead(file: test.ts)");
  });
});
