/**
 * Amendment 10 (TR1b): where each `ToolExecutionResultRouter` heuristic
 * sends a shape, pinned as a table (scratch/tr1b/reachability.md, "Router
 * heuristics"; the report's heuristic table carries the source shape and
 * the keep / delete decision per row).
 *
 * Each renderer the router can reach is replaced by a stub that names
 * itself, so the table pins the routing alone, not the renderers' bodies.
 * The rows use the real Claude Code `toolUseResult` shapes that need them,
 * plus the documented false positive: R8's bare `status` key sends Claude
 * async-agent results to the Git card before R13 can see them.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ToolExecutionResultRouter } from "@/components/messageRenderer/ToolExecutionResultRouter";

vi.mock("@/components/toolResultRenderer", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const name of Object.keys(actual)) {
    stubs[name] = typeof actual[name] === "function" || typeof actual[name] === "object" ? () => <div data-renderer={name} /> : actual[name];
  }
  return stubs;
});
vi.mock("@/components/FileContent", () => ({ FileContent: () => <div data-renderer="FileContent" /> }));

type Row = [id: string, toolResult: Record<string, unknown> | string | unknown[], renderer: string | null];

const JSONL = [JSON.stringify({ type: "user", message: { content: "hi" } }), JSON.stringify({ type: "assistant", message: { content: "hello" } })].join("\n");

const TABLE: Row[] = [
  ["R1 array (MCP toolUseResult blocks)", [{ type: "text", text: "x" }], "ContentArrayRenderer"],
  ["R2 'Error: ' string", "Error: File does not exist.", "ErrorRenderer"],
  ["R3 JSONL session history string", JSONL, "ClaudeSessionHistoryRenderer"],
  ["R4 plain string", "plain output", "StringRenderer"],
  ["R5 mcp_tool_call + method", { type: "mcp_tool_call", method: "tools/call" }, "MCPRenderer"],
  ["R5 server + function", { server: "github", function: "create_issue" }, "MCPRenderer"],
  ["R6 files_analyzed", { files_analyzed: 3 }, "CodebaseContextRenderer"],
  ["R6 contextWindow", { contextWindow: 200000 }, "CodebaseContextRenderer"],
  ["R7 command + output + stdout", { command: "ls", output: "a", stdout: "a" }, "TerminalStreamRenderer"],
  ["R8 git command", { command: "git status" }, "GitWorkflowRenderer"],
  ["R8 bare status (Claude async agent completion: false positive, documented)", { agentId: "a1", status: "completed", content: [{ type: "text", text: "done" }] }, "GitWorkflowRenderer"],
  ["R8 diff", { diff: "--- a\n+++ b" }, "GitWorkflowRenderer"],
  ["R9 WebSearch {query, results}", { query: "q", results: ["I'll search"], durationSeconds: 1 }, "WebSearchRenderer"],
  ["R10 TodoWrite {oldTodos, newTodos}", { oldTodos: [], newTodos: [] }, "TodoUpdateRenderer"],
  ["R11 TaskCreate {task}", { task: { id: "1", subject: "s" } }, "TaskResultRenderer"],
  ["R11 TaskUpdate {success, taskId}", { success: true, taskId: "1", updatedFields: [] }, "TaskResultRenderer"],
  ["R12 Glob {filenames, numFiles}", { filenames: ["a.ts"], numFiles: 1, durationMs: 3, truncated: false }, "FileListRenderer"],
  ["R13 async agent launch {agentId, isAsync}", { agentId: "a1", isAsync: true }, null],
  ["R14 Read {file}", { type: "text", file: { filePath: "/a.ts", content: "x", numLines: 1, startLine: 1, totalLines: 1 } }, "FileContent"],
  ["R15 Edit {filePath, oldString, newString}", { filePath: "/a.ts", oldString: "a", newString: "b", originalFile: "a" }, "FileEditRenderer"],
  ["R16 Write-create {filePath, structuredPatch}", { type: "create", filePath: "/a.ts", content: "x", structuredPatch: [] }, "StructuredPatchRenderer"],
  ["R18 Task {content: [...]}", { content: [{ type: "text", text: "x" }], totalDurationMs: 5 }, "ContentArrayRenderer"],
  ["R19 {content: string}", { content: "x" }, "StringRenderer"],
  ["R20 Bash {stdout, stderr, interrupted, isImage}", { stdout: "x", stderr: "", interrupted: false, isImage: false }, "generic"],
  ["R21 anything else", { foo: 1 }, "FallbackRenderer"],
];

describe("ToolExecutionResultRouter heuristics (amendment 10 table)", () => {
  it.each(TABLE)("%s", (_id, toolResult, expected) => {
    const { container } = render(
      <ExpandKeyProvider value="router-table">
        <ToolExecutionResultRouter toolResult={toolResult} />
      </ExpandKeyProvider>,
    );
    const reached = [...container.querySelectorAll("[data-renderer]")].map((el) => el.getAttribute("data-renderer"));
    if (expected === null) {
      expect(container.innerHTML).toBe("");
    } else if (expected === "generic") {
      expect(reached).toEqual([]);
      expect(container.textContent).toContain("x");
    } else {
      expect(reached[0]).toBe(expected);
    }
  });
});
