/**
 * TaskOperationGroupRenderer - Renders grouped task operations as a unified board
 *
 * Merges TaskUpdate operations into their corresponding TaskCreate entries,
 * showing only the latest status per task. TaskUpdate rows are not displayed separately.
 */

import { memo, useState, useMemo } from "react";
import {
  ChevronRight,
  ListTodo,
  ListPlus,
  ArrowRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import type { TaskOperation, TaskInfo } from "../MessageViewer/helpers/taskOperationHelpers";
import { TASK_STATUS_CONFIG } from "./taskStatusConfig";

interface Props {
  operations: TaskOperation[];
  taskRegistry?: Map<string, TaskInfo>;
}

/** Merged task: a TaskCreate with latest status from subsequent TaskUpdates */
interface MergedTask {
  id: string;
  subject?: string;
  description?: string;
  status?: string;
  /** Whether this task originated from a TaskCreate */
  isCreate: boolean;
  /** Original operation */
  createOp: TaskOperation;
}

/**
 * Merge operations: TaskCreate defines a task row, TaskUpdate updates its status.
 * Non-Create/Update operations (TaskGet, TaskList, etc.) are shown as-is.
 */
function mergeOperations(operations: TaskOperation[], taskRegistry?: Map<string, TaskInfo>): {
  tasks: MergedTask[];
  otherOps: TaskOperation[];
} {
  const taskMap = new Map<string, MergedTask>();
  const taskOrder: string[] = [];
  const otherOps: TaskOperation[] = [];

  for (const op of operations) {
    const taskId = op.task?.id ?? (op.input.taskId as string | undefined);

    if (op.toolName === "TaskCreate" && taskId) {
      if (!taskMap.has(taskId)) {
        taskOrder.push(taskId);
      }
      taskMap.set(taskId, {
        id: taskId,
        subject: op.task?.subject ?? (op.input.subject as string | undefined),
        description: op.task?.description ?? (op.input.description as string | undefined),
        status: op.task?.status ?? (op.input.status as string | undefined) ?? "pending",
        isCreate: true,
        createOp: op,
      });
    } else if (op.toolName === "TaskUpdate" && taskId) {
      const existing = taskMap.get(taskId);

      if (existing) {
        // Merge: update status from TaskUpdate result
        const newStatus = op.task?.status ?? (op.input.status as string | undefined);
        if (newStatus) existing.status = newStatus;
        // Update subject if provided
        const newSubject = op.task?.subject ?? (op.input.subject as string | undefined) ?? (op.input.activeForm as string | undefined);
        if (newSubject && !existing.subject) existing.subject = newSubject;
      } else {
        // TaskUpdate without a preceding TaskCreate — show as standalone task row
        if (!taskMap.has(taskId)) {
          taskOrder.push(taskId);
        }
        const registryInfo = taskRegistry?.get(taskId);
        taskMap.set(taskId, {
          id: taskId,
          subject: op.task?.subject ?? (op.input.subject as string | undefined) ?? (op.input.activeForm as string | undefined) ?? registryInfo?.subject,
          description: registryInfo?.description,
          status: op.task?.status ?? (op.input.status as string | undefined),
          isCreate: false,
          createOp: op,
        });
      }
    } else {
      otherOps.push(op);
    }
  }

  const tasks = taskOrder.map((id) => taskMap.get(id)).filter((t): t is MergedTask => t != null);
  return { tasks, otherOps };
}

const TaskRow = memo(function TaskRow({
  task,
}: {
  task: MergedTask;
}) {
  const { t } = useTranslation();
  const statusInfo = task.status ? TASK_STATUS_CONFIG[task.status] : null;
  const StatusIcon = statusInfo?.icon ?? TASK_STATUS_CONFIG["pending"]!.icon;
  const statusColor = statusInfo?.color ?? "text-muted-foreground";
  const hasDescription = task.isCreate && !!task.description;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={hasDescription ? () => setExpanded(!expanded) : undefined}
        aria-label={hasDescription ? (expanded ? t("taskOperation.collapse", { defaultValue: "Collapse" }) : t("taskOperation.expand", { defaultValue: "Expand" })) : undefined}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 text-left",
          hasDescription && "hover:bg-muted/50 transition-colors",
          !hasDescription && "cursor-default"
        )}
      >
        {hasDescription ? (
          <ChevronRight
            className={cn(
              "w-3 h-3 shrink-0 transition-transform text-muted-foreground",
              expanded && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <ListPlus className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className={cn(layout.monoText, "text-muted-foreground shrink-0")}>
          #{task.id}
        </span>
        <span className={cn(layout.smallText, "text-foreground/80 truncate flex-1")}>
          {task.subject ?? ""}
        </span>
        <StatusIcon
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            statusColor,
            task.status === "in_progress" && "animate-spin"
          )}
        />
      </button>

      {expanded && task.description && (
        <div className={cn("px-4 pb-2", layout.smallText)}>
          <span className={cn("text-foreground/70", layout.bodyText)}>
            {task.description}
          </span>
        </div>
      )}
    </div>
  );
});

const OtherOpRow = memo(function OtherOpRow({ op }: { op: TaskOperation }) {
  const taskId = op.task?.id ?? (op.input.taskId as string | undefined);
  const subject = op.task?.subject ?? (op.input.subject as string | undefined);

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="w-3 shrink-0" />
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className={cn(layout.monoText, "text-muted-foreground shrink-0")}>
          {op.toolName}
        </span>
        {taskId && (
          <span className={cn(layout.monoText, "text-muted-foreground shrink-0")}>
            #{taskId}
          </span>
        )}
        <span className={cn(layout.smallText, "text-foreground/80 truncate flex-1")}>
          {subject ?? ""}
        </span>
      </div>
    </div>
  );
});

export const TaskOperationGroupRenderer = memo(function TaskOperationGroupRenderer({
  operations,
  taskRegistry,
}: Props) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const styles = getVariantStyles("task");

  const { tasks, otherOps } = useMemo(() => mergeOperations(operations, taskRegistry), [operations, taskRegistry]);

  const taskCount = tasks.length;
  const summary = t("taskOperation.taskCount", { count: taskCount });

  return (
    <div className={cn(layout.rounded, "border overflow-hidden", styles.container)}>
      {/* Group Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={isExpanded ? t("taskOperation.collapse") : t("taskOperation.expand")}
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
        <ListTodo className={cn("w-4 h-4 shrink-0", styles.icon)} />
        <span className={cn(layout.smallText, "font-medium", styles.title)}>
          {t("taskOperation.taskOperations", { defaultValue: "Task Operations" })}
        </span>

        {/* Summary Badge */}
        <span
          className={cn(
            layout.smallText,
            "px-2 py-0.5 rounded-full font-medium",
            styles.badge,
            styles.badgeText
          )}
        >
          {summary}
        </span>
      </button>

      {/* Task List */}
      {isExpanded && (
        <div className="border-t border-border/50">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
            />
          ))}
          {otherOps.map((op, i) => (
            <OtherOpRow
              key={`other-${i}`}
              op={op}
            />
          ))}
        </div>
      )}
    </div>
  );
});
