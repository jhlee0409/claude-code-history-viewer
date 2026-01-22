"use client";

import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToolExecutionResultRouter } from "./messageRenderer";
import { ToolIcon } from "./ToolIcon";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

type Props = {
  toolUse?: Record<string, unknown>;
  toolResult: unknown;
  defaultExpanded?: boolean;
  searchQuery?: string;
};

const isSmallResult = (result: unknown): boolean => {
  if (typeof result === "string") return result.length < 500;
  if (typeof result === "object" && result !== null) {
    const json = JSON.stringify(result);
    return json.length < 1000;
  }
  return true;
};

const getResultSummary = (result: unknown, t: TranslateFn): string => {
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
      return hasOutput ? t("collapsibleToolResult.terminalOutput") : t("collapsibleToolResult.noOutput");
    }

    // Content
    if (r.content && typeof r.content === "string") {
      return r.content.slice(0, 50) + (r.content.length > 50 ? "..." : "");
    }

    // Todo changes
    if (r.oldTodos || r.newTodos) {
      return t("collapsibleToolResult.todoListUpdated");
    }

    // Edit result
    if (r.edits && Array.isArray(r.edits)) {
      return t("collapsibleToolResult.editsCount", { count: r.edits.length });
    }
  }

  return "";
};

export const getToolName = (toolUse?: Record<string, unknown>, toolResult?: unknown, t?: TranslateFn): string => {
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

export const CollapsibleToolResult = ({
  toolUse,
  toolResult,
  defaultExpanded,
  searchQuery,
}: Props) => {
  const { t } = useTranslation("components");
  const toolName = getToolName(toolUse, toolResult, t);
  const shouldExpandByDefault = defaultExpanded ?? isSmallResult(toolResult);
  const [isExpanded, setIsExpanded] = useState(shouldExpandByDefault);

  // 검색 쿼리가 있고 내용에 매칭되면 자동으로 펼치기
  useEffect(() => {
    if (searchQuery) {
      const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);
      if (resultStr.toLowerCase().includes(searchQuery.toLowerCase())) {
        setIsExpanded(true);
      }
    }
  }, [searchQuery, toolResult]);

  const summary = getResultSummary(toolResult, t);

  return (
    <div className="border border-border rounded-lg mt-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-secondary transition-colors"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200 text-muted-foreground",
            isExpanded && "rotate-90"
          )}
        />
        <ToolIcon toolName={toolName} className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className={`${layout.smallText} font-medium text-muted-foreground`}>{toolName}</span>
        {!isExpanded && summary && (
          <span className={`${layout.smallText} text-muted-foreground truncate`}>
            {summary}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          <ToolExecutionResultRouter toolResult={toolResult as Record<string, unknown> | string} depth={0} />
        </div>
      )}
    </div>
  );
};
