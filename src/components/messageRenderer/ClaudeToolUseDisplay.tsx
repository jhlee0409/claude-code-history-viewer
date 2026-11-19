import React from "react";
import { ToolUseRenderer } from "../contentRenderer/ToolUseRenderer";

interface ClaudeToolUseDisplayProps {
  toolUse: Record<string, unknown>;
}

/**
 * A message's legacy top-level `toolUse` field, shown only when its content
 * array holds no `tool_use` block (ClaudeMessageNode). Claude's loader fills
 * the field from the content's own block, so for Claude it is reached only by
 * a raw record carrying a `toolUse` and no tool_use block; ForgeCode reaches
 * it with an object content (`providers/forgecode.rs`; TR1c owns that shape).
 *
 * TR1b: the same ToolRow as any unpaired call (`ToolUseRenderer`): the
 * recorded name (`name`, or another provider's `tool`) · "No result
 * recorded"; opened, the routed body of its input (`input`, or another
 * provider's `parameters`; with neither, the whole object as JSON, so every
 * recorded key stays visible). The old card's "<name> - <description>"
 * title read a `description` beside `input` that no known shape records
 * (amendment 10: deleted).
 */
export const ClaudeToolUseDisplay: React.FC<ClaudeToolUseDisplayProps> = ({ toolUse }) => {
  const name = typeof toolUse.name === "string" ? toolUse.name : typeof toolUse.tool === "string" ? toolUse.tool : "";
  const input = toolUse.input ?? toolUse.parameters ?? toolUse;
  return <ToolUseRenderer toolUse={{ type: "tool_use", id: toolUse.id, name, input }} />;
};
