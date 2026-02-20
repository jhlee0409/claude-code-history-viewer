/**
 * AgentTaskGroupRenderer - Renders grouped async agent tasks
 *
 * Groups parallel agent tasks started at the same time into a single card
 * with progress indicator and collapsible details.
 */

import { memo, useState } from "react";
import {
  ChevronRight,
  Bot,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

export interface AgentTask {
  agentId: string;
  description: string;
  status: "async_launched" | "completed" | "error" | "running";
  outputFile?: string;
  prompt?: string;
}

interface AgentTaskGroupRendererProps {
  tasks: AgentTask[];
  timestamp?: string;
}

const STATUS_CONFIG = {
  async_launched: {
    icon: Loader2,
    color: "text-info",
    animate: true,
    label: "running",
  },
  running: {
    icon: Loader2,
    color: "text-info",
    animate: true,
    label: "running",
  },
  completed: {
    icon: CheckCircle2,
    color: "text-success",
    animate: false,
    label: "completed",
  },
  error: {
    icon: AlertCircle,
    color: "text-destructive",
    animate: false,
    label: "error",
  },
} as const;

const AgentTaskItem = memo(function AgentTaskItem({
  task,
  isExpanded,
  onToggle,
}: {
  task: AgentTask;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.async_launched;
  const StatusIcon = config.icon;

  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.outputFile) {
      await navigator.clipboard.writeText(task.outputFile);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 text-left",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        <ChevronRight
          className={cn(
            "w-3 h-3 shrink-0 transition-transform text-muted-foreground",
            isExpanded && "rotate-90"
          )}
        />
        <StatusIcon
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            config.color,
            config.animate && "animate-spin"
          )}
        />
        <code className={cn(layout.monoText, "text-muted-foreground shrink-0")}>
          {task.agentId}
        </code>
        <span className={cn(layout.smallText, "text-foreground/80 truncate flex-1")}>
          {task.description}
        </span>
      </button>

      {isExpanded && (
        <div className={cn("px-4 pb-2", layout.smallText)}>
          {task.prompt && (
            <div className="mb-2">
              <div className="text-muted-foreground mb-1">
                {t("agentTaskGroup.prompt")}
              </div>
              <pre className={cn(
                "p-2 rounded bg-muted/50 text-foreground/80 whitespace-pre-wrap",
                "max-h-32 overflow-y-auto",
                layout.monoText
              )}>
                {task.prompt}
              </pre>
            </div>
          )}

          {task.outputFile && (
            <div className="flex items-center gap-2">
              <FileText className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t("agentTaskGroup.transcript")}
              </span>
              <code className={cn(
                layout.monoText,
                "text-foreground/70 truncate max-w-[300px]"
              )}>
                {task.outputFile.split("/").pop()}
              </code>
              <button
                type="button"
                onClick={handleCopyPath}
                className={cn(
                  "p-1 rounded hover:bg-muted transition-colors",
                  "text-muted-foreground hover:text-foreground"
                )}
                title={t("agentTaskGroup.copyPath")}
              >
                {copied ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const AgentTaskGroupRenderer = memo(function AgentTaskGroupRenderer({
  tasks,
}: AgentTaskGroupRendererProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const styles = getVariantStyles("task");

  const completedCount = tasks.filter(
    (t) => t.status === "completed"
  ).length;
  const hasErrors = tasks.some((t) => t.status === "error");
  const allCompleted = completedCount === tasks.length && !hasErrors;
  const isRunning = tasks.some(
    (t) => t.status === "async_launched" || t.status === "running"
  );

  const toggleTask = (agentId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  // Single task - render inline
  if (tasks.length === 1 && tasks[0]) {
    const task = tasks[0];
    const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.async_launched;
    const StatusIcon = config.icon;

    return (
      <div className={cn(layout.rounded, "border", styles.container)}>
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
            {t("agentTaskGroup.agent")}
          </span>
          <code className={cn(layout.monoText, "text-muted-foreground")}>
            {task.agentId}
          </code>
          <span className={cn(layout.smallText, "text-foreground/80 truncate flex-1")}>
            {task.description}
          </span>
          <StatusIcon
            className={cn(
              "w-4 h-4 shrink-0",
              config.color,
              config.animate && "animate-spin"
            )}
          />
        </button>

        {isExpanded && (
          <div className={cn("px-3 pb-3", layout.smallText)}>
            {task.prompt && (
              <div className="mb-2">
                <div className="text-muted-foreground mb-1">
                  {t("agentTaskGroup.prompt")}
                </div>
                <pre className={cn(
                  "p-2 rounded bg-muted/50 text-foreground/80 whitespace-pre-wrap",
                  "max-h-40 overflow-y-auto",
                  layout.monoText
                )}>
                  {task.prompt}
                </pre>
              </div>
            )}

            {task.outputFile && (
              <div className="flex items-center gap-2 mt-2">
                <FileText className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t("agentTaskGroup.transcript")}
                </span>
                <code className={cn(
                  layout.monoText,
                  "text-foreground/70 truncate"
                )}>
                  {task.outputFile}
                </code>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Multiple tasks - grouped view
  return (
    <div className={cn(layout.rounded, "border overflow-hidden", styles.container)}>
      {/* Group Header */}
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
          {t("agentTaskGroup.parallelTasks")}
        </span>

        {/* Progress Badge */}
        <span
          className={cn(
            layout.smallText,
            "px-2 py-0.5 rounded-full font-medium",
            allCompleted
              ? "bg-success/20 text-success"
              : hasErrors
              ? "bg-destructive/20 text-destructive"
              : "bg-info/20 text-info"
          )}
        >
          {completedCount}/{tasks.length}{" "}
          {t("agentTaskGroup.completed")}
        </span>

        {/* Running indicator */}
        {isRunning && (
          <Loader2 className="w-3.5 h-3.5 text-info animate-spin ml-auto" />
        )}
        {allCompleted && (
          <CheckCircle2 className="w-3.5 h-3.5 text-success ml-auto" />
        )}
        {hasErrors && !isRunning && (
          <AlertCircle className="w-3.5 h-3.5 text-destructive ml-auto" />
        )}
      </button>

      {/* Task List */}
      {isExpanded && (
        <div className="border-t border-border/50">
          {tasks.map((task) => (
            <AgentTaskItem
              key={task.agentId}
              task={task}
              isExpanded={expandedTasks.has(task.agentId)}
              onToggle={() => toggleTask(task.agentId)}
            />
          ))}
        </div>
      )}
    </div>
  );
});
