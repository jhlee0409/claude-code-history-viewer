/**
 * The tool kind (signal audit #14, owner decision 2026-10-25): what a tool
 * call is, in the user's language, for the row icon's accessible name and
 * native tooltip — Bash → "Terminal" / "터미널", Read → "File read" … The row
 * keeps the recorded tool name as its visible verb (D-R5); the kind only
 * explains it.
 *
 * One map, keyed by the canonical name (`canonicalToolName`: provider
 * aliases such as `shell` → Bash reach the same kind as the same card) or by
 * the exact recorded name the routed bodies know (`todowrite`,
 * `update_plan`, `apply_patch`). Every other name — MCP tools, unknown
 * tools, and names that merely contain a known word (`BashOutput`,
 * `ReadMcpResourceTool`) — is the generic kind ("Tool" / "도구"): a kind is
 * never guessed from a substring.
 */
import type { TFunction } from "i18next";
import { canonicalToolName } from "../contentRenderer/toolNames";

export type ToolKind =
  | "terminal"
  | "fileRead"
  | "fileWrite"
  | "fileEdit"
  | "contentSearch"
  | "fileSearch"
  | "webSearch"
  | "webFetch"
  | "agent"
  | "workflow"
  | "question"
  | "todoList"
  | "plan"
  | "notebookEdit"
  | "taskList"
  | "generic";

const KIND_BY_NAME: Readonly<Record<string, ToolKind>> = {
  Bash: "terminal",
  Read: "fileRead",
  Write: "fileWrite",
  Edit: "fileEdit",
  MultiEdit: "fileEdit",
  // Codex records file edits as one patch (routed to the JSON body for now).
  apply_patch: "fileEdit",
  Grep: "contentSearch",
  Glob: "fileSearch",
  WebSearch: "webSearch",
  WebFetch: "webFetch",
  Agent: "agent",
  Task: "agent",
  Workflow: "workflow",
  AskUserQuestion: "question",
  TodoWrite: "todoList",
  // OpenCode records the same tool in lower case.
  todowrite: "todoList",
  update_plan: "plan",
  NotebookEdit: "notebookEdit",
  TaskCreate: "taskList",
  TaskUpdate: "taskList",
};

const LABEL_KEY: Readonly<Record<ToolKind, string>> = {
  terminal: "toolRow.kindTerminal",
  fileRead: "toolRow.kindFileRead",
  fileWrite: "toolRow.kindFileWrite",
  fileEdit: "toolRow.kindFileEdit",
  contentSearch: "toolRow.kindContentSearch",
  fileSearch: "toolRow.kindFileSearch",
  webSearch: "toolRow.kindWebSearch",
  webFetch: "toolRow.kindWebFetch",
  agent: "toolRow.kindAgent",
  workflow: "toolRow.kindWorkflow",
  question: "toolRow.kindQuestion",
  todoList: "toolRow.kindTodoList",
  plan: "toolRow.kindPlan",
  notebookEdit: "toolRow.kindNotebookEdit",
  taskList: "toolRow.kindTaskList",
  generic: "toolRow.kindGeneric",
};

/** The kind of a recorded tool name; `generic` for every name the map does not list. */
export function toolKind(recordedName: string): ToolKind {
  if (Object.hasOwn(KIND_BY_NAME, recordedName)) return KIND_BY_NAME[recordedName] as ToolKind;
  const canonical = canonicalToolName(recordedName);
  return Object.hasOwn(KIND_BY_NAME, canonical) ? (KIND_BY_NAME[canonical] as ToolKind) : "generic";
}

/** The kind of a recorded tool name in the current language. */
export function toolKindLabel(recordedName: string, t: TFunction): string {
  return t(LABEL_KEY[toolKind(recordedName)]);
}
