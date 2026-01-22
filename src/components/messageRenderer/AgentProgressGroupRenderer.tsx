/**
 * AgentProgressGroupRenderer - Renders grouped agent progress logs
 *
 * Groups progress messages from the same agentId into a collapsible view,
 * showing only the latest status in the header.
 */

import { memo, useState, useMemo } from "react";
import {
  ChevronRight,
  Bot,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileEdit,
  FileSearch,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import type { ProgressData } from "@/types";

interface AgentProgressEntry {
  data: ProgressData;
  timestamp: string;
  uuid: string;
}

interface AgentProgressGroupRendererProps {
  entries: AgentProgressEntry[];
  agentId: string;
}

// Extract a summary from the latest message
const getProgressSummary = (data: ProgressData): string => {
  // Try to get tool name from normalizedMessages
  if (data.normalizedMessages && data.normalizedMessages.length > 0) {
    const lastMsg = data.normalizedMessages[data.normalizedMessages.length - 1];
    if (lastMsg?.message?.content) {
      const content = lastMsg.message.content;
      if (Array.isArray(content)) {
        const toolUse = content.find((c: { type?: string }) => c.type === "tool_use");
        if (toolUse && typeof toolUse === "object" && "name" in toolUse) {
          return String(toolUse.name);
        }
        const text = content.find((c: { type?: string }) => c.type === "text");
        if (text && typeof text === "object" && "text" in text) {
          const textContent = String(text.text);
          // Truncate long text
          return textContent.length > 60 ? textContent.slice(0, 60) + "..." : textContent;
        }
      }
    }
  }

  // Fallback to prompt summary
  if (data.prompt) {
    const firstLine = data.prompt.split("\n")[0] || "";
    return firstLine.length > 60 ? firstLine.slice(0, 60) + "..." : firstLine;
  }

  return "";
};

// Get icon for the current action
const getActionIcon = (data: ProgressData) => {
  if (data.normalizedMessages && data.normalizedMessages.length > 0) {
    const lastMsg = data.normalizedMessages[data.normalizedMessages.length - 1];
    if (lastMsg?.message?.content) {
      const content = lastMsg.message.content;
      if (Array.isArray(content)) {
        const toolUse = content.find((c: { type?: string }) => c.type === "tool_use");
        if (toolUse && typeof toolUse === "object" && "name" in toolUse) {
          const toolName = String(toolUse.name).toLowerCase();
          if (toolName.includes("edit") || toolName.includes("write")) return FileEdit;
          if (toolName.includes("read") || toolName.includes("glob") || toolName.includes("grep")) return FileSearch;
          if (toolName.includes("bash")) return Terminal;
        }
      }
    }
  }
  return Bot;
};

// Single progress entry for expanded view
const ProgressEntry = memo(function ProgressEntry({
  entry,
  index,
}: {
  entry: AgentProgressEntry;
  index: number;
}) {
  const summary = getProgressSummary(entry.data);
  const ActionIcon = getActionIcon(entry.data);
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();

  return (
    <div className={cn(
      "flex items-start gap-2 py-1.5 px-2 border-b border-border/30 last:border-b-0",
      layout.smallText
    )}>
      <span className="text-muted-foreground shrink-0 tabular-nums w-6">
        {index + 1}.
      </span>
      <ActionIcon className={cn(layout.iconSizeSmall, "text-muted-foreground shrink-0 mt-0.5")} />
      <div className="flex-1 min-w-0">
        <span className="text-foreground/80 break-words">{summary || "Processing..."}</span>
      </div>
      <span className="text-muted-foreground/70 shrink-0 tabular-nums">
        {timestamp}
      </span>
    </div>
  );
});

export const AgentProgressGroupRenderer = memo(function AgentProgressGroupRenderer({
  entries,
  agentId,
}: AgentProgressGroupRendererProps) {
  const { t } = useTranslation("components");
  const [isExpanded, setIsExpanded] = useState(false);
  const styles = getVariantStyles("info");

  // Get the latest entry for summary
  const latestEntry = entries[entries.length - 1];
  const latestData = latestEntry?.data;

  // Determine status
  const isCompleted = latestData?.status === "completed";
  const hasError = latestData?.status === "error";
  const isRunning = !isCompleted && !hasError;

  // Get summary from latest entry
  const summary = useMemo(() => {
    if (!latestData) return "";
    return getProgressSummary(latestData);
  }, [latestData]);

  const ActionIcon = latestData ? getActionIcon(latestData) : Bot;

  return (
    <div className={cn(layout.rounded, "border overflow-hidden", styles.container)}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-muted/30 transition-colors"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 transition-transform text-muted-foreground",
            isExpanded && "rotate-90"
          )}
        />
        <Bot className={cn("w-4 h-4 shrink-0", styles.icon)} />
        <span className={cn(layout.smallText, "font-medium", styles.title)}>
          {t("agentProgressGroup.agent", { defaultValue: "Agent" })}
        </span>
        <code className={cn(layout.monoText, "text-muted-foreground")}>
          {agentId}
        </code>

        {/* Current action */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <ActionIcon className={cn(layout.iconSizeSmall, "text-muted-foreground shrink-0")} />
          <span className={cn(layout.smallText, "text-foreground/70 truncate")}>
            {summary}
          </span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            layout.smallText,
            "px-1.5 py-0.5 rounded",
            isCompleted ? "bg-success/20 text-success" :
            hasError ? "bg-destructive/20 text-destructive" :
            "bg-info/20 text-info"
          )}>
            {entries.length} {t("agentProgressGroup.steps", { defaultValue: "steps" })}
          </span>
          {isRunning && <Loader2 className="w-3.5 h-3.5 text-info animate-spin" />}
          {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
          {hasError && <AlertCircle className="w-3.5 h-3.5 text-destructive" />}
        </div>
      </button>

      {/* Expanded Progress List */}
      {isExpanded && (
        <div className="border-t border-border/50 max-h-64 overflow-y-auto">
          {entries.map((entry, index) => (
            <ProgressEntry
              key={entry.uuid}
              entry={entry}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
});
