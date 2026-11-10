import type { ClaudeMessage, ContentItem } from "@/types";
import type { FlattenedMessageItem } from "@/components/MessageViewer/types";
import { assistant, user, flattened } from "@/components/transcript/transcriptItems.fixtures";
import { flattenMessageTree } from "@/components/MessageViewer/helpers/flattenMessageTree";
import { groupAgentTasks } from "@/components/MessageViewer/helpers/agentTaskHelpers";
import { groupAgentProgressMessages } from "@/components/MessageViewer/helpers/agentProgressHelpers";
import { groupTaskOperations } from "@/components/MessageViewer/helpers/taskOperationHelpers";
import { records } from "./transcript.renderParity.fixtures";

export const sourceRow = (message: ClaudeMessage) => flattened([message]).find((row): row is FlattenedMessageItem => row.type === "message")!;
const record = (content: unknown[]) => assistant("acceptance", content as ContentItem[]);
const text = (text: string) => ({ type: "text", text });
export const rawExtras = { absent: null, disabled: false, count: 0, empty: "", nested: { values: [null, false, 0, "", { needle: "nested needle" }] } };
export const producerDiff = "--- a/recorded.ts\n+++ b/recorded.ts\n@@ -1 +1 @@\n-producer-old\n+producer-needle\n";
const evidence = { fileChanges: [{ sourceLine: 4, record: { type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", id: "recorded-change", status: "completed", changes: { "recorded.ts": { type: "update", unified_diff: producerDiff, move_path: null } } } } } }] };
const carriers: [string, ClaudeMessage][] = [
  ["default array FileChange", record([text("prefix needle"), text("suffix needle")])],
  ["default string FileChange", assistant("acceptance", "string needle")],
  ["empty FileChange", assistant("acceptance", [])],
  ["progress started FileChange", { ...user("acceptance", ""), type: "progress", data: { type: "waiting_for_task", status: "started", taskId: "task" } }],
  ["progress completed FileChange", { ...user("acceptance", ""), type: "progress", data: { type: "waiting_for_task", status: "completed", taskId: "task" } }],
  ["system FileChange", { ...user("acceptance", "system needle"), type: "system", subtype: "microcompact_boundary" }],
];
const serverResults = [
  ["web_search_tool_result", [{ type: "web_search_result", title: "web needle", url: "https://example.test/web", encrypted_content: "recorded", page_age: "today" }]],
  ["web_fetch_tool_result", { type: "web_fetch_result", url: "https://example.test/needle", content: { type: "document", source: { type: "text", media_type: "text/plain", data: "fetch needle" } } }],
  ["code_execution_tool_result", { type: "code_execution_result", stdout: "code needle\n", stderr: "", return_code: 0, content: [] }],
  ["bash_code_execution_tool_result", { type: "bash_code_execution_result", stdout: "bash needle\n", stderr: "", return_code: 0, content: [] }],
  ["text_editor_code_execution_tool_result", { type: "text_editor_code_execution_view_result", file_type: "text", content: "editor needle", numLines: 1, startLine: 1, totalLines: 1 }],
  ["tool_search_tool_result", [{ type: "tool_reference", tool_name: "needle" }]],
  ["advisor_tool_result", { text: "advisor needle", ...rawExtras }],
  ["mcp_tool_result", [text("mcp needle")]],
] as const;
export const supplementalRecords: [string, ClaudeMessage][] = [
  ...carriers.map(([name, message]): [string, ClaudeMessage] => [name, { ...message, provider: "codex", codexEvidence: evidence }]),
  ["snapshot present", { ...user("acceptance", ""), type: "file-history-snapshot", messageId: "snapshot-id", snapshot: { messageId: "snapshot-id", timestamp: "2026-01-01T12:00:00Z", trackedFileBackups: { "recorded.ts": { originalPath: "recorded.ts", timestamp: "2026-01-01T12:00:00Z", content: "snapshot needle" } } } }],
  ["legacy with array siblings", { ...record([text("prefix needle"), { type: "thinking", thinking: "reason needle" }, text("tail needle")]), toolUse: { id: "legacy", name: "Read", input: { file_path: "/project/legacy.ts", ...rawExtras } }, toolUseResult: { stdout: "legacy needle\n\tend", stderr: "", ...rawExtras } }],
  ["source extras", { ...record([text("prefix needle"), { type: "future", ...rawExtras }, text("tail needle")]), toolUseResult: { recorded: rawExtras } }],
  ["command item stdout", record([{ type: "command", content: "<command-name>/help</command-name><command-message>command needle</command-message><local-command-stdout>stdout needle\n\tend</local-command-stdout>" }, text("tail needle")])],
  ["remaining entry families", record([
    text("prefix needle"),
    { type: "critical_system_reminder", content: "reminder needle" },
    { type: "search_result", source: "https://example.test/needle", title: "search needle", content: [text("result needle")] },
    { type: "container_upload", file_id: "file-needle" },
    { type: "opencode_step", reason: "completed", snapshot: "snapshot needle", cost: 0, tokens: { input: 0, output: 0 } },
    { type: "future", ...rawExtras }, text("tail needle"),
  ])],
  ...serverResults.flatMap(([type, content]): [string, ClaudeMessage][] => [
    [`paired ${type}`, record([text("prefix needle"), { type: type === "mcp_tool_result" ? "mcp_tool_use" : "server_tool_use", id: "server", name: type.replace("_tool_result", ""), tool_name: "lookup", server_name: "catalog", input: { query: "needle", ...rawExtras } }, { type, tool_use_id: "server", content }, text("tail needle")])],
    [`orphan ${type}`, record([text("prefix needle"), { type, tool_use_id: "absent", content }, text("tail needle")])],
  ]),
];

function groupedRows(messages: ClaudeMessage[]) {
  const agentTaskGroups = groupAgentTasks(messages);
  const agentProgressGroups = groupAgentProgressMessages(messages);
  const taskOperationGroups = groupTaskOperations(messages);
  const members = (groups: Map<string, { messageUuids: Set<string> }>) => new Set([...groups].flatMap(([leader, group]) => [...group.messageUuids].filter(uuid => uuid !== leader)));
  return flattenMessageTree({ messages, agentTaskGroups, agentTaskMemberUuids: members(agentTaskGroups), agentProgressGroups, agentProgressMemberUuids: members(agentProgressGroups), taskOperationGroups, taskOperationMemberUuids: members(taskOperationGroups) }).filter((row): row is FlattenedMessageItem => row.type === "message");
}
export const groupCases: [string, FlattenedMessageItem[]][] = [
  ["tasks", groupedRows(["task-a", "task-b"].map((uuid, index) => ({ ...user(uuid, ""), toolUseResult: { isAsync: true, agentId: uuid, description: `description ${index} needle`, prompt: `prompt ${index} needle\n\tend`, outputFile: `/recorded/${uuid}.jsonl` } })))],
  ["agent-progress", groupedRows(["progress-a", "progress-b"].map((uuid, index) => ({ ...user(uuid, ""), type: "progress", data: { type: "agent_progress", agentId: "agent", prompt: "progress needle", message: { type: "assistant", content: [text(`progress ${index} needle`)] } } })))],
  ["operations", groupedRows([
    assistant("operation-a", [{ type: "tool_use", id: "operation-call", name: "TaskCreate", input: { subject: "operation needle", description: "description needle" } }]),
    { ...user("operation-b", ""), toolUseResult: { task: { id: "1", subject: "operation needle", description: "description needle", status: "pending" } } },
  ])],
];
export const sourceCases: [string, FlattenedMessageItem][] = [
  ...[...records, ...supplementalRecords].map(([name, message]): [string, FlattenedMessageItem] => [name, sourceRow(message)]),
  ...groupCases.map(([name, rows]): [string, FlattenedMessageItem] => [name, rows[0]!]),
];
