"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToolExecutionResultRouter } from "./messageRenderer";
import { ToolIcon } from "./ToolIcon";
import { cn } from "../utils/cn";

type Props = {
  toolUse?: Record<string, unknown>;
  toolResult: unknown;
  defaultExpanded?: boolean;
};

const isSmallResult = (result: unknown): boolean => {
  if (typeof result === "string") return result.length < 500;
  if (typeof result === "object" && result !== null) {
    const json = JSON.stringify(result);
    return json.length < 1000;
  }
  return true;
};

const getResultSummary = (result: unknown, toolName: string): string => {
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;

    // File operations
    if (r.filePath) return String(r.filePath);
    if (r.file && typeof r.file === "object") {
      const f = r.file as Record<string, unknown>;
      if (f.filePath) return String(f.filePath);
    }

    // Command output
    if (r.stdout || r.stderr) {
      const hasOutput = r.stdout || r.stderr;
      return hasOutput ? "Terminal output" : "No output";
    }

    // Content
    if (r.content && typeof r.content === "string") {
      return r.content.slice(0, 50) + (r.content.length > 50 ? "..." : "");
    }

    // Todo changes
    if (r.oldTodos || r.newTodos) {
      return "Todo list updated";
    }

    // Edit result
    if (r.edits && Array.isArray(r.edits)) {
      return `${r.edits.length} edit(s)`;
    }
  }

  return "";
};

export const getToolName = (toolUse?: Record<string, unknown>, toolResult?: unknown): string => {
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

  return "Result";
};

export const CollapsibleToolResult = ({
  toolUse,
  toolResult,
  defaultExpanded,
}: Props) => {
  const { t } = useTranslation("components");
  const toolName = getToolName(toolUse, toolResult);
  const shouldExpandByDefault = defaultExpanded ?? isSmallResult(toolResult);
  const [isExpanded, setIsExpanded] = useState(shouldExpandByDefault);

  const summary = getResultSummary(toolResult, toolName);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg mt-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200 text-gray-400 dark:text-gray-500",
            isExpanded && "rotate-90"
          )}
        />
        <ToolIcon toolName={toolName} className="w-4 h-4 shrink-0 text-gray-500 dark:text-gray-400" />
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{toolName}</span>
        {!isExpanded && summary && (
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
            {summary}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          <ToolExecutionResultRouter toolResult={toolResult} depth={0} />
        </div>
      )}
    </div>
  );
};
