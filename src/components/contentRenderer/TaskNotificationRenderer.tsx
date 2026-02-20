/* eslint-disable react-refresh/only-export-components */
/**
 * TaskNotificationRenderer - Mission Control style agent task dashboard
 *
 * Displays parallel agent tasks with clear visual hierarchy and status indicators.
 * Design: Industrial/Utilitarian - inspired by mission control dashboards
 */
import { useState, useMemo, memo, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  Terminal,
  Zap,
  Clock,
  Hash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { layout, getVariantStyles } from "@/components/renderers";

type Props = {
  text: string;
};

interface TaskNotification {
  taskId?: string;
  status?: "completed" | "running" | "failed" | string;
  summary?: string;
  result?: string;
}

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    label: "DONE",
    dotClass: "bg-success",
    textClass: "text-success",
    pulseClass: "",
  },
  running: {
    icon: Loader2,
    label: "ACTIVE",
    dotClass: "bg-info",
    textClass: "text-info",
    pulseClass: "animate-pulse",
    iconClass: "animate-spin",
  },
  failed: {
    icon: XCircle,
    label: "FAIL",
    dotClass: "bg-destructive",
    textClass: "text-destructive",
    pulseClass: "",
  },
} as const;

// Truncate task ID for display
const formatTaskId = (id: string | undefined): string => {
  if (!id) return "---";
  // Show first 8 chars if longer
  return id.length > 8 ? id.slice(0, 8) : id;
};

// Single task row component - minimal, data-dense design
const TaskRow = memo(function TaskRow({
  notification,
  index,
  isExpanded,
  onToggle,
}: {
  notification: TaskNotification;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusKey = (notification.status || "completed") as keyof typeof STATUS_CONFIG;
  const config = STATUS_CONFIG[statusKey] || STATUS_CONFIG.completed;
  const hasExpandableContent = notification.result || notification.summary;
  const Icon = config.icon;

  return (
    <div className={cn(
      "group transition-colors",
      isExpanded ? "bg-muted/30" : "hover:bg-muted/20"
    )}>
      {/* Task row - grid layout for alignment */}
      <button
        onClick={() => hasExpandableContent && onToggle()}
        disabled={!hasExpandableContent}
        className={cn(
          "w-full grid grid-cols-[auto_1fr_auto_auto] items-center gap-3",
          "px-3 py-2 text-left",
          hasExpandableContent ? "cursor-pointer" : "cursor-default"
        )}
      >
        {/* Index number */}
        <span className="text-2xs font-mono text-muted-foreground/50 w-4 text-right">
          {String(index + 1).padStart(2, "0")}
        </span>

        {/* Task info */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Status dot with pulse animation */}
          <div className={cn(
            "w-1.5 h-1.5 rounded-full flex-shrink-0",
            config.dotClass,
            config.pulseClass
          )} />

          {/* Task ID badge */}
          <code className={cn(
            "text-2xs font-mono px-1.5 py-0.5 rounded",
            "bg-background/80 text-foreground/80",
            "border border-border/50"
          )}>
            {formatTaskId(notification.taskId)}
          </code>

          {/* Summary text */}
          {notification.summary && (
            <span className={cn(
              "text-2xs text-muted-foreground truncate",
              "opacity-70 group-hover:opacity-100 transition-opacity"
            )}>
              {notification.summary}
            </span>
          )}
        </div>

        {/* Status label */}
        <span className={cn(
          "text-3xs font-mono font-medium tracking-wider",
          config.textClass
        )}>
          {config.label}
        </span>

        {/* Expand indicator or status icon */}
        <div className="w-4 flex justify-center">
          {hasExpandableContent ? (
            <ChevronDown className={cn(
              "w-3 h-3 text-muted-foreground/50",
              "transition-transform duration-200",
              isExpanded && "rotate-180"
            )} />
          ) : (
            <Icon className={cn(
              "w-3 h-3",
              config.textClass,
              "iconClass" in config ? config.iconClass : ""
            )} />
          )}
        </div>
      </button>

      {/* Expanded result content */}
      {isExpanded && hasExpandableContent && (
        <div className={cn(
          "px-3 pb-3 ml-7 mr-3",
          "animate-fade-in"
        )}>
          <div className={cn(
            "rounded-md border border-border/50",
            "bg-background/50 backdrop-blur-sm",
            "overflow-hidden"
          )}>
            {/* Result header */}
            <div className={cn(
              "flex items-center gap-2 px-2.5 py-1.5",
              "border-b border-border/30",
              "bg-muted/30"
            )}>
              <Terminal className="w-3 h-3 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wide">
                Output
              </span>
            </div>

            {/* Result content */}
            <div className={cn(
              "p-2.5 max-h-48 overflow-y-auto overflow-x-auto",
              "text-2xs"
            )}>
              {notification.result ? (
                <div className={cn(layout.prose, "text-2xs")}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {notification.result}
                  </ReactMarkdown>
                </div>
              ) : notification.summary ? (
                <p className="text-foreground/70">{notification.summary}</p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// Get first N lines of text for preview
const getPreviewLines = (text: string, lineCount: number = 3): string => {
  const lines = text.split('\n').filter(line => line.trim());
  return lines.slice(0, lineCount).join('\n');
};

export const TaskNotificationRenderer = memo(function TaskNotificationRenderer({ text }: Props) {
  const { t } = useTranslation();
  const [isGroupExpanded, setIsGroupExpanded] = useState(true); // Default open
  const [expandedTaskIndices, setExpandedTaskIndices] = useState<Set<number>>(new Set());
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false); // Details collapsed by default

  // Get task variant styles
  const styles = getVariantStyles("task");

  // Parse notifications
  const notifications = useMemo(() => {
    const taskNotificationRegex = /<task-notification>([\s\S]*?)<\/task-notification>/g;
    const matches = [...text.matchAll(taskNotificationRegex)];

    return matches.map((match) => {
      const content = match[1] || "";

      const extractTag = (tagName: string): string | undefined => {
        const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
        const tagMatch = content?.match(regex);
        return tagMatch?.[0]
          ?.replace(new RegExp(`</?${tagName}>`, "g"), "")
          .trim();
      };

      return {
        taskId: extractTag("task-id"),
        status: extractTag("status"),
        summary: extractTag("summary"),
        result: extractTag("result"),
      };
    });
  }, [text]);

  // Count by status
  const statusCounts = useMemo(() => {
    const counts = { completed: 0, running: 0, failed: 0 };
    notifications.forEach(n => {
      const status = (n.status || "completed") as keyof typeof counts;
      if (status in counts) counts[status]++;
      else counts.completed++;
    });
    return counts;
  }, [notifications]);

  const toggleTaskExpanded = useCallback((index: number) => {
    setExpandedTaskIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  if (notifications.length === 0) {
    return null;
  }

  // Remove task-notification tags from text to get remaining content
  const remainingText = text
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/^\s*\n/gm, "")
    .trim();

  // Determine if all completed
  const allCompleted = statusCounts.completed === notifications.length;
  const hasRunning = statusCounts.running > 0;
  const hasFailed = statusCounts.failed > 0;

  return (
    <div className="space-y-2">
      {/* Mission Control Card */}
      <div className={cn(
        "rounded-lg border overflow-hidden",
        "bg-gradient-to-b from-card to-card/80",
        styles.container
      )}>
        {/* Header - Mission Control style */}
        <button
          onClick={() => setIsGroupExpanded(!isGroupExpanded)}
          className={cn(
            "w-full flex items-center justify-between",
            "px-3 py-2",
            "bg-gradient-to-r from-transparent via-muted/20 to-transparent",
            "hover:from-muted/10 hover:via-muted/30 hover:to-muted/10",
            "transition-all duration-200"
          )}
        >
          {/* Left side: Icon + Title + Count */}
          <div className="flex items-center gap-2">
            <ChevronDown className={cn(
              "w-3.5 h-3.5 text-muted-foreground",
              "transition-transform duration-200",
              !isGroupExpanded && "-rotate-90"
            )} />

            <div className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded",
              "bg-tool-task/10"
            )}>
              <Zap className="w-3.5 h-3.5 text-tool-task" />
              <span className="text-xs font-medium text-tool-task">
                {t("taskNotification.agentTasks")}
              </span>
            </div>

            {/* Count badge */}
            <div className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded",
              "bg-background/60 border border-border/50"
            )}>
              <Hash className="w-2.5 h-2.5 text-muted-foreground" />
              <span className="text-2xs font-mono font-medium text-foreground/80">
                {notifications.length}
              </span>
            </div>
          </div>

          {/* Right side: Status indicators */}
          <div className="flex items-center gap-3">
            {/* Status pills */}
            <div className="flex items-center gap-1.5">
              {statusCounts.completed > 0 && (
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded",
                  "bg-success/10 border border-success/20"
                )}>
                  <CheckCircle2 className="w-2.5 h-2.5 text-success" />
                  <span className="text-3xs font-mono text-success">
                    {statusCounts.completed}
                  </span>
                </div>
              )}
              {statusCounts.running > 0 && (
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded",
                  "bg-info/10 border border-info/20",
                  "animate-pulse-subtle"
                )}>
                  <Loader2 className="w-2.5 h-2.5 text-info animate-spin" />
                  <span className="text-3xs font-mono text-info">
                    {statusCounts.running}
                  </span>
                </div>
              )}
              {statusCounts.failed > 0 && (
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded",
                  "bg-destructive/10 border border-destructive/20"
                )}>
                  <XCircle className="w-2.5 h-2.5 text-destructive" />
                  <span className="text-3xs font-mono text-destructive">
                    {statusCounts.failed}
                  </span>
                </div>
              )}
            </div>

            {/* Overall status indicator */}
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded",
              allCompleted ? "bg-success/5 text-success" :
              hasFailed ? "bg-destructive/5 text-destructive" :
              hasRunning ? "bg-info/5 text-info" :
              "bg-muted/50 text-muted-foreground"
            )}>
              <Clock className="w-3 h-3" />
              <span className="text-3xs font-mono font-medium uppercase tracking-wider">
                {allCompleted ? "Complete" :
                 hasFailed ? "Error" :
                 hasRunning ? "Running" : "Pending"}
              </span>
            </div>
          </div>
        </button>

        {/* Task list */}
        {isGroupExpanded && (
          <div className={cn(
            "border-t border-border/50",
            "divide-y divide-border/30"
          )}>
            {notifications.map((notification, index) => (
              <TaskRow
                key={`${notification.taskId || index}-${index}`}
                notification={notification}
                index={index}
                isExpanded={expandedTaskIndices.has(index)}
                onToggle={() => toggleTaskExpanded(index)}
              />
            ))}
          </div>
        )}

        {/* Remaining text - inside card as collapsible content section */}
        {remainingText && (
          <div className={cn(
            "border-t border-border/50",
            "bg-gradient-to-b from-muted/20 to-transparent"
          )}>
            {/* Section header - clickable */}
            <button
              onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-1.5",
                "hover:bg-muted/20 transition-colors",
                "text-left"
              )}
            >
              <div className="flex items-center gap-2">
                <ChevronDown className={cn(
                  "w-3 h-3 text-muted-foreground",
                  "transition-transform duration-200",
                  !isDetailsExpanded && "-rotate-90"
                )} />
                <Terminal className="w-3 h-3 text-muted-foreground" />
                <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("taskNotification.details")}
                </span>
              </div>
              <span className="text-3xs text-muted-foreground/60">
                {isDetailsExpanded ? "Collapse" : "Expand"}
              </span>
            </button>

            {/* Content - preview or full */}
            <div className={cn(
              "px-3 py-2.5",
              "border-t border-border/20"
            )}>
              {isDetailsExpanded ? (
                // Full content
                <div className={cn(layout.prose, "text-2xs animate-fade-in")}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {remainingText}
                  </ReactMarkdown>
                </div>
              ) : (
                // 3-line preview
                <div
                  className="cursor-pointer"
                  onClick={() => setIsDetailsExpanded(true)}
                >
                  <div className={cn(
                    layout.prose,
                    "text-2xs",
                    "line-clamp-3 text-muted-foreground"
                  )}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {getPreviewLines(remainingText, 3)}
                    </ReactMarkdown>
                  </div>
                  <span className="text-3xs text-info mt-1 inline-block">
                    {t("taskNotification.showMore")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Check if text contains task-notification tags
 */
export const hasTaskNotification = (text: string): boolean => {
  return /<task-notification>[\s\S]*?<\/task-notification>/.test(text);
};
