/**
 * TaskResultRenderer - Renders task operation results
 *
 * Handles results from TaskCreate, TaskUpdate, TaskGet with shape: {task: {id, subject, status, ...}}
 * Also handles TaskOutput results with shape: {retrieval_status, task: {task_id, description, status, ...}}
 * Also handles TaskList results with shape: {tasks: [...]}
 */

import { memo } from "react";
import {
  ListTodo,
  ArrowRight,
  Ban,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { Renderer } from "@/shared/RendererHeader";
import { TASK_STATUS_CONFIG } from "./taskStatusConfig";

interface TaskData {
  id?: string;
  subject?: string;
  status?: string;
  description?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
}

interface Props {
  toolResult: Record<string, unknown>;
}

/**
 * Normalize task data from different API shapes:
 * - TaskCreate/Update/Get: {id, subject, status, ...}
 * - TaskOutput: {task_id, description, status, task_type, ...}
 */
function normalizeTask(raw: Record<string, unknown>): TaskData {
  return {
    id: (raw.id ?? raw.task_id) as string | undefined,
    subject: (raw.subject ?? raw.description) as string | undefined,
    status: raw.status as string | undefined,
    description: raw.description as string | undefined,
    owner: raw.owner as string | undefined,
    blocks: raw.blocks as string[] | undefined,
    blockedBy: raw.blockedBy as string[] | undefined,
  };
}

const TaskRow = memo(function TaskRow({ task }: { task: TaskData }) {
  const statusInfo = task.status ? TASK_STATUS_CONFIG[task.status] : TASK_STATUS_CONFIG["pending"]!;
  const StatusIcon = statusInfo?.icon ?? TASK_STATUS_CONFIG["pending"]!.icon;
  const color = statusInfo?.color ?? "text-muted-foreground";

  return (
    <div className={cn("flex items-center gap-2 px-2 py-1.5 border-b border-border/50 last:border-b-0")}>
      <StatusIcon className={cn(layout.iconSizeSmall, color, task.status === "in_progress" && "animate-spin")} />
      {task.id && (
        <span className={cn(layout.monoText, "text-muted-foreground shrink-0")}>
          #{task.id}
        </span>
      )}
      <span className={cn(layout.bodyText, "text-foreground truncate flex-1")}>
        {task.subject ?? "—"}
      </span>
      {task.owner && (
        <code className={cn(layout.monoText, "text-muted-foreground shrink-0")}>
          @{task.owner}
        </code>
      )}
      {task.blockedBy && task.blockedBy.length > 0 && (
        <div className="flex items-center gap-0.5 shrink-0">
          <Ban className={cn("w-2.5 h-2.5 text-warning")} />
          <span className={cn(layout.monoText, "text-warning")}>
            {task.blockedBy.join(",")}
          </span>
        </div>
      )}
    </div>
  );
});

export const TaskResultRenderer = memo(function TaskResultRenderer({ toolResult }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");

  const getStatusLabel = (status: string) => {
    const keyMap: Record<string, string> = {
      pending: "taskOperation.pending",
      in_progress: "taskOperation.inProgress",
      completed: "taskOperation.completed",
      deleted: "taskOperation.deleted",
    };
    return t(keyMap[status] ?? "taskOperation.pending");
  };

  // Single task result: {task: {id, subject, ...}} or {task: {task_id, description, ...}}
  if (toolResult.task != null && typeof toolResult.task === "object") {
    const task = normalizeTask(toolResult.task as Record<string, unknown>);
    const statusInfo = task.status ? TASK_STATUS_CONFIG[task.status] : null;

    return (
      <Renderer className={styles.container} enableToggle={false}>
        <Renderer.Header
          title={t("toolResult.taskResult")}
          icon={<ListTodo className={cn(layout.iconSize, styles.icon)} />}
          titleClassName={styles.title}
          rightContent={
            <div className={cn("flex items-center gap-2", layout.smallText)}>
              {task.id && (
                <span className={cn("px-1.5 py-0.5 font-mono", layout.rounded, styles.badge, styles.badgeText)}>
                  #{task.id}
                </span>
              )}
              {statusInfo && task.status && (
                <span className={cn("px-1.5 py-0.5", layout.rounded, "bg-card border border-border", statusInfo.color)}>
                  {getStatusLabel(task.status)}
                </span>
              )}
            </div>
          }
        />
        <Renderer.Content>
          <div className={cn("p-2 border bg-card border-border", layout.rounded)}>
            <TaskRow task={task} />
          </div>
        </Renderer.Content>
      </Renderer>
    );
  }

  // TaskUpdate result: {success, taskId, updatedFields, statusChange: {from, to}}
  if (toolResult.success != null && typeof toolResult.taskId === "string") {
    const taskId = toolResult.taskId as string;
    const statusChange = toolResult.statusChange as Record<string, string> | undefined;
    const newStatus = statusChange?.to;
    const oldStatus = statusChange?.from;
    const statusInfo = newStatus ? TASK_STATUS_CONFIG[newStatus] : null;
    const StatusIcon = statusInfo?.icon ?? TASK_STATUS_CONFIG["completed"]!.icon;

    return (
      <Renderer className={styles.container} enableToggle={false}>
        <Renderer.Header
          title={t("toolResult.taskUpdated")}
          icon={<ListTodo className={cn(layout.iconSize, styles.icon)} />}
          titleClassName={styles.title}
          rightContent={
            <div className={cn("flex items-center gap-2", layout.smallText)}>
              <span className={cn("px-1.5 py-0.5 font-mono", layout.rounded, styles.badge, styles.badgeText)}>
                #{taskId}
              </span>
              {statusInfo && newStatus && (
                <span className={cn("px-1.5 py-0.5", layout.rounded, "bg-card border border-border", statusInfo.color)}>
                  {getStatusLabel(newStatus)}
                </span>
              )}
            </div>
          }
        />
        <Renderer.Content>
          <div className={cn("flex items-center gap-2 px-2 py-1.5 border bg-card border-border", layout.rounded)}>
            <StatusIcon className={cn(layout.iconSizeSmall, statusInfo?.color ?? "text-success")} />
            <span className={cn(layout.monoText, "text-muted-foreground")}>#{taskId}</span>
            {oldStatus && newStatus && (
              <span className={cn(layout.smallText, "text-muted-foreground")}>
                {oldStatus} → <span className={statusInfo?.color ?? ""}>{newStatus}</span>
              </span>
            )}
            {Array.isArray(toolResult.updatedFields) && (
              <span className={cn(layout.smallText, "text-muted-foreground")}>
                [{(toolResult.updatedFields as string[]).join(", ")}]
              </span>
            )}
          </div>
        </Renderer.Content>
      </Renderer>
    );
  }

  // Multiple tasks result: {tasks: [...]} from TaskList
  if (Array.isArray(toolResult.tasks)) {
    const tasks = (toolResult.tasks as Record<string, unknown>[]).map(normalizeTask);
    const completed = tasks.filter((t) => t.status === "completed").length;

    return (
      <Renderer className={styles.container}>
        <Renderer.Header
          title={t("toolResult.taskList")}
          icon={<ListTodo className={cn(layout.iconSize, styles.icon)} />}
          titleClassName={styles.title}
          rightContent={
            <div className={cn("flex items-center gap-2", layout.smallText)}>
              <span className={cn(
                "px-1.5 py-0.5", layout.rounded,
                completed === tasks.length ? "bg-success/20 text-success" : "bg-info/20 text-info"
              )}>
                {completed}/{tasks.length}
              </span>
            </div>
          }
        />
        <Renderer.Content>
          <div className={cn("border bg-card border-border", layout.rounded, "divide-y divide-border/50")}>
            {tasks.map((task, i) => (
              <TaskRow key={task.id ?? i} task={task} />
            ))}
          </div>
        </Renderer.Content>
      </Renderer>
    );
  }

  // Fallback: show message string if present
  if (typeof toolResult.message === "string") {
    return (
      <Renderer className={styles.container} enableToggle={false}>
        <Renderer.Header
          title={t("toolResult.taskResult")}
          icon={<ArrowRight className={cn(layout.iconSize, styles.icon)} />}
          titleClassName={styles.title}
        />
        <Renderer.Content>
          <div className={cn(layout.bodyText, "text-foreground")}>{toolResult.message}</div>
        </Renderer.Content>
      </Renderer>
    );
  }

  return null;
});
