import fs from "node:fs";
/** Synthetic records mirror the pinned SDK, not claimed as collected histories.
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7085-L7192
 * Tool search L8010-L8057; server tool names L6894-L6902; advisor L360-L405. */
export const serverToolCases = [
  ["view", "text_editor_code_execution", "text_editor_code_execution_tool_result", { type: "text_editor_code_execution_view_result", content: "viewneedle", file_type: "text", start_line: 8, num_lines: 1, total_lines: 20 }],
  ["create", "text_editor_code_execution", "text_editor_code_execution_tool_result", { type: "text_editor_code_execution_create_result", is_file_update: false }],
  ["replace", "text_editor_code_execution", "text_editor_code_execution_tool_result", { type: "text_editor_code_execution_str_replace_result", lines: ["-before", "+replacementneedle"], old_start: 40, new_start: 42, old_lines: 1, new_lines: 1 }],
  ["error", "text_editor_code_execution", "text_editor_code_execution_tool_result", { type: "text_editor_code_execution_tool_result_error", error_code: "file_not_found", error_message: "errorneedle" }],
  ["references", "tool_search_tool_regex", "tool_search_tool_result", { type: "tool_search_tool_search_result", tool_references: [{ type: "tool_reference", tool_name: "referenceneedle" }] }],
  ["redacted", "advisor", "advisor_tool_result", { type: "advisor_redacted_result", encrypted_content: "opaque-secret" }],
];
export function plantServerTools(fixture) {
  const target = fixture.namedSessions["unknown-outcome"];
  const project = fixture.projects.find(p => p.name === target.project);
  const session = project.sessions.find(s => s.title === target.title);
  const template = fs.readFileSync(session.filePath, "utf8").trim().split("\n").map(JSON.parse).find(r => r.type === "user");
  const raw = [{ ...template, uuid: "sdk-question", message: { role: "user", content: session.title } }];
  for (const [id, name, type, content] of serverToolCases) raw.push({ ...template, type: "assistant", uuid: `sdk-${id}`, message: { role: "assistant", content: [{ type: "server_tool_use", id: `sdk-tool-${id}`, name, input: { synthetic_case: id } }, { type, tool_use_id: `sdk-tool-${id}`, content }] } });
  raw.push({ ...template, type: "assistant", uuid: "sdk-web", message: { role: "assistant", content: [{ type: "tool_use", id: "sdk-web", name: "WebSearch", input: { query: "synthetic links" } }] } });
  raw.push({ ...template, uuid: "sdk-web-result", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "sdk-web", content: "commentary" }] }, toolUseResult: { query: "synthetic links", results: [{ tool_use_id: "sdk-web", content: [0,1,2].map(i => ({ title: `Synthetic link ${i}`, url: `https://example.test/${i}` })) }, "commentary"] } });
  fs.writeFileSync(session.filePath, raw.map(JSON.stringify).join("\n") + "\n");
  return { session, raw };
}
