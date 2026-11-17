/**
 * The structured bodies TR1a's D-R1 table routes TodoWrite and update_plan
 * to (`toolBodies.tsx`), unchanged. They used to live in the legacy
 * `toolUseRenderers/TodoWriteToolRenderer` / `UpdatePlanToolRenderer`
 * cards, which TR1b absorbed into the ToolRow patterns and deleted
 * (amendment 9): those cards' only remaining content is here, shown inside a
 * ToolRow's Input zone. The Checklist pattern (static 4-glyph set, D-R3)
 * replaces them in TR4.
 */
import { CircleCheck, Circle, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { TASK_STATUS_CONFIG } from "@/components/toolResultRenderer/taskStatusConfig";
import { Marked, type TextHighlight } from "../../transcript/ToolRow";

export interface TodoItem {
  id?: string;
  content?: string;
  status?: string;
  priority?: string;
}

const StatusIcon = ({ status }: { status?: string }) => {
  switch (status) {
    case "completed":
      return <CircleCheck className={cn(layout.iconSizeSmall, "text-success shrink-0")} />;
    case "in_progress":
      return <LoaderCircle className={cn(layout.iconSizeSmall, "text-info shrink-0")} />;
    default:
      return <Circle className={cn(layout.iconSizeSmall, "text-muted-foreground shrink-0")} />;
  }
};

/**
 * The structured todo list (also the TR1a ToolRow body for TodoWrite, which
 * passes `highlight` so search hits in the item text are marked).
 */
export function TodoWriteList({ todos, highlight }: { todos: TodoItem[]; highlight?: TextHighlight }) {
  return (
    <div className="space-y-1">
      {todos.map((todo, i) => (
        <div
          key={todo.id ?? i}
          className={cn("flex items-start gap-2 p-1.5 border border-border", layout.rounded, "bg-card")}
        >
          <StatusIcon status={todo.status} />
          <div className="min-w-0 flex-1">
            <span className={cn(layout.bodyText, "text-foreground")}>
              <Marked text={todo.content ?? JSON.stringify(todo)} highlight={highlight} />
            </span>
            {todo.priority && todo.priority !== "medium" && (
              <span className={cn(
                "ml-2 px-1 py-0.5 font-mono", layout.smallText, layout.rounded,
                todo.priority === "high" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"
              )}>
                <Marked text={todo.priority} highlight={highlight} />
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PlanStep {
  step?: string;
  status?: string;
}

export interface UpdatePlanToolInput {
  explanation?: string;
  plan?: PlanStep[];
}

const getStatusLabelKey = (status: string) => {
  const keyMap: Record<string, string> = {
    pending: "taskOperation.pending",
    in_progress: "taskOperation.inProgress",
    completed: "taskOperation.completed",
    deleted: "taskOperation.deleted",
  };
  return keyMap[status] ?? "taskOperation.pending";
};

/**
 * The plan's explanation and steps (also the TR1a ToolRow body for
 * update_plan, which passes `highlight` so search hits are marked).
 */
export function UpdatePlanSteps({ input, highlight }: { input: UpdatePlanToolInput; highlight?: TextHighlight }) {
  const { t } = useTranslation();
  const steps = input.plan ?? [];
  return (
    <div className="space-y-1.5">
      {input.explanation && (
        <div className={cn("p-2 border border-border bg-card", layout.rounded, layout.bodyText, "text-foreground whitespace-pre-wrap")}>
          <Marked text={input.explanation} highlight={highlight} />
        </div>
      )}
      {steps.map((planStep, index) => {
        const status = planStep.status ?? "pending";
        const statusConfig = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG["pending"]!;
        const { icon: StatusIcon, color } = statusConfig;

        return (
          <div
            key={`${status}-${index}`}
            className={cn("p-2 border border-border bg-card", layout.rounded, "space-y-1")}
          >
            <div className={cn("flex items-center gap-1.5", layout.smallText)}>
              <StatusIcon className={cn(layout.iconSizeSmall, color)} aria-hidden="true" />
              <span className={cn("font-medium", color)}>
                {t(getStatusLabelKey(status))}
              </span>
            </div>
            <div className={cn(layout.bodyText, "text-foreground")}>
              <Marked text={planStep.step ?? ""} highlight={highlight} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
