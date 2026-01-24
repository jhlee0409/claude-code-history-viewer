/**
 * Utility functions for tool name detection and display
 */

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * Get the display name for a tool based on toolUse or toolResult structure
 */
export const getToolName = (
  toolUse?: Record<string, unknown>,
  toolResult?: unknown,
  t?: TranslateFn
): string => {
  // Get name from toolUse if available
  if (toolUse?.name) return String(toolUse.name);

  // Try to infer from toolResult structure
  if (typeof toolResult === "object" && toolResult !== null) {
    const r = toolResult as Record<string, unknown>;

    // Sub-agent/Task result
    if (r.agentId || r.totalDurationMs) return "Task";

    // File read result
    if (r.file) return "Read";

    // Command result
    if ("stdout" in r || "stderr" in r) return "Bash";

    // Edit result
    if (r.edits || r.oldString || r.newString) return "Edit";

    // Todo result
    if (r.oldTodos || r.newTodos) return "TodoWrite";
  }

  return t ? t("collapsibleToolResult.result") : "Result";
};
