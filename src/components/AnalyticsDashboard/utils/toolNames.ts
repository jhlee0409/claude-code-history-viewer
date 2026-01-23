/**
 * Tool Names Utility
 *
 * Maps tool names to display names.
 */

import type { TFunction } from "i18next";

/**
 * Get display name for a tool
 */
export const getToolDisplayName = (toolName: string, t: TFunction): string => {
  const toolMap: Record<string, string> = {
    Bash: t("tools.terminal"),
    Read: t("tools.readFile"),
    Edit: t("tools.editFile"),
    Write: t("tools.createFile"),
    MultiEdit: t("tools.multiEdit"),
    Glob: t("tools.findFiles"),
    Grep: t("tools.searchText"),
    LS: t("tools.browseDirectory"),
    Task: t("tools.executeTask"),
    WebFetch: t("tools.webFetch"),
    WebSearch: t("tools.webSearch"),
    NotebookRead: t("tools.notebookRead"),
    NotebookEdit: t("tools.notebookEdit"),
    TodoRead: t("tools.todoRead"),
    TodoWrite: t("tools.todoWrite"),
    exit_plan_mode: t("tools.exitPlanMode"),
  };

  return toolMap[toolName] || toolName;
};
