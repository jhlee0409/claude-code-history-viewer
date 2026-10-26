import { memo } from "react";
import { ServerToolUseRenderer } from "./ServerToolUseRenderer";

type Props = {
  /** The recorded `mcp_tool_use` block (`id`, `server_name`, `tool_name`, `input`). */
  toolUse: Record<string, unknown>;
  /** Its `mcp_tool_result` blocks from the same message. */
  results?: Record<string, unknown>[];
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

/**
 * An MCP connector call (`mcp_tool_use`, TR1b): the server-call ToolRow with
 * the recorded `tool_name` as the verb (D-R5) and the `server_name` as caption
 * meta, the input as JSON, its `mcp_tool_result` in the Result zone. MCP tools
 * have no exit code: the outcome is "Failed" on `is_error`, else quiet
 * (`other` family). Before TR1b: a `ToolUseCard` "MCP tool call" with a
 * "server / tool" line and a "Show input" fold.
 */
export const MCPToolUseRenderer = memo(function MCPToolUseRenderer({ toolUse, results, searchQuery, isCurrentMatch, currentMatchIndex }: Props) {
  return (
    <ServerToolUseRenderer
      toolUse={toolUse}
      results={results}
      verb={typeof toolUse.tool_name === "string" ? toolUse.tool_name : ""}
      serverName={typeof toolUse.server_name === "string" ? toolUse.server_name : undefined}
      family="other"
      searchQuery={searchQuery}
      isCurrentMatch={isCurrentMatch}
      currentMatchIndex={currentMatchIndex}
    />
  );
});
