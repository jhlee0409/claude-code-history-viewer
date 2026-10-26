/**
 * How a content array's blocks become rendered entries (TR1b): a tool call
 * and the results that answer it are one entry, so they render as one row.
 *
 * - `tool_use` with a string id → a `toolExecution` entry; every later block
 *   whose `tool_use_id` matches joins it (the paired path, TR0 / TR1a).
 * - `server_tool_use` / `mcp_tool_use` → a `serverExecution` entry; a later
 *   server / API result block (`web_search_tool_result`, `mcp_tool_result`
 *   …, `SERVER_RESULT_TYPES`) whose `tool_use_id` matches joins it. Claude
 *   records the call and its result in the same assistant message, so they
 *   pair here; before TR1b they were two cards and the call claimed nothing
 *   about its outcome.
 * - Anything else, and a result whose call is not in this array (a
 *   page-boundary orphan, a server result without its call), stays an
 *   `item` in place.
 *
 * Pure: `ClaudeContentArrayRenderer` (a message's content) and
 * `ContentArrayRenderer` (a content array inside a tool result) share it.
 */

export type ContentEntry =
  | { kind: "toolExecution"; key: string; toolUse: Record<string, unknown>; toolResults: Record<string, unknown>[] }
  | { kind: "serverExecution"; key: string; toolUse: Record<string, unknown>; results: Record<string, unknown>[] }
  | { kind: "item"; key: string; item: unknown; index: number };

/** The server / API result block types a `server_tool_use` / `mcp_tool_use` call is answered by. */
export const SERVER_RESULT_TYPES: ReadonlySet<string> = new Set([
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
  "tool_search_tool_result",
  "advisor_tool_result",
  "mcp_tool_result",
]);

const SERVER_CALL_TYPES: ReadonlySet<string> = new Set(["server_tool_use", "mcp_tool_use"]);

const isObject = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === "object";

export function contentEntries(content: unknown[]): ContentEntry[] {
  const entries: ContentEntry[] = [];
  const toolCalls = new Map<string, number>();
  const serverCalls = new Map<string, number>();

  content.forEach((item, index) => {
    if (!isObject(item)) {
      entries.push({ kind: "item", key: `item-${index}`, item, index });
      return;
    }

    if (item.type === "tool_use" && typeof item.id === "string") {
      entries.push({ kind: "toolExecution", key: `tool-${index}`, toolUse: item, toolResults: [] });
      toolCalls.set(item.id, entries.length - 1);
      return;
    }

    if (typeof item.type === "string" && SERVER_CALL_TYPES.has(item.type)) {
      entries.push({ kind: "serverExecution", key: `server-${index}`, toolUse: item, results: [] });
      if (typeof item.id === "string") serverCalls.set(item.id, entries.length - 1);
      return;
    }

    if (typeof item.tool_use_id === "string") {
      const call = entries[toolCalls.get(item.tool_use_id) ?? -1];
      if (call?.kind === "toolExecution") {
        call.toolResults.push(item);
        return;
      }
      const server = entries[serverCalls.get(item.tool_use_id) ?? -1];
      if (server?.kind === "serverExecution" && typeof item.type === "string" && SERVER_RESULT_TYPES.has(item.type)) {
        server.results.push(item);
        return;
      }
    }

    entries.push({ kind: "item", key: `item-${index}`, item, index });
  });

  return entries;
}
