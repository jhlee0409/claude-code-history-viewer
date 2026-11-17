import { assistant, user } from "@/components/transcript/transcriptItems.fixtures";
import type { ClaudeMessage, ContentItem } from "@/types";
const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" } };
const text = (value: string) => ({ type: "text", text: value });
const record = (content: unknown[]) => assistant("parity", content as ContentItem[]);
const call = { type: "tool_use", id: "call", name: "Read", input: { file_path: "/project/test.ts", extra: { null: null, false: false, zero: 0, empty: "" } } };
export const records: [string, ClaudeMessage][] = [
  ["string", user("parity", "first needle")],
  ["array", record([text("first needle"), text("second needle")])],
  ["image-first legacy order", record([image, text("first needle")])],
  ["mixed", record([text("first needle"), image, text("last needle")])],
  ["thinking", record([{ type: "thinking", thinking: "reason needle" }, { type: "redacted_thinking", data: "redacted" }])],
  ["unknown-extras", record([{ type: "future", null: null, false: false, zero: 0, empty: "", nested: { values: [null, false, 0, ""] } }])],
  ["document", record([{ type: "document", source: { type: "text", media_type: "text/plain", data: "document needle" }, title: "recorded document" }])],
  ["paired", record([text("first needle"), call, { type: "tool_result", tool_use_id: "call", content: [text("result needle"), image, text("tail needle")] }])],
  ["unpaired", record([call])],
  ["idless", record([{ ...call, id: undefined }])],
  ["orphan", record([{ type: "tool_result", tool_use_id: "absent", content: "orphan needle" }])],
  ["server", record([{ type: "server_tool_use", id: "server", name: "web_search", input: { query: "needle" } }, { type: "web_search_tool_result", tool_use_id: "server", content: [] }])],
  ["server-orphan", record([{ type: "web_search_tool_result", tool_use_id: "absent", content: [] }])],
  ["mcp", record([{ type: "mcp_tool_use", id: "mcp", name: "lookup", tool_name: "lookup", server_name: "catalog", input: { query: "needle" } }, { type: "mcp_tool_result", tool_use_id: "mcp", content: [text("mcp needle")] }])],
  ["legacy", { ...assistant("parity", "first needle"), toolUse: { id: "legacy", name: "Read", input: { file_path: "/project/legacy.ts" } }, toolUseResult: { stdout: "legacy needle", stderr: "", interrupted: false } }],
  ["summary", { ...user("parity", "summary needle"), type: "summary" }],
  ["system", { ...user("parity", "system needle"), type: "system", subtype: "local_command" }],
  ["progress", { ...user("parity", ""), type: "progress", data: { type: "bash_progress", output: "progress needle", fullOutput: "progress needle", elapsedTimeSeconds: 1, totalLines: 1 } } as ClaudeMessage],
  ["empty", assistant("parity", [])],
  ["snapshot absent", { ...user("parity", ""), type: "file-history-snapshot" }],
  ["command", user("parity", "<command-name>/help</command-name><command-message>needle</command-message><local-command-stdout>output</local-command-stdout>")],
];

