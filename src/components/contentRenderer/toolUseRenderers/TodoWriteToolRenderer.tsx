import { memo } from "react";
import { ListTodo, CircleCheck, Circle, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { Marked, type TextHighlight } from "../../transcript/ToolRow";
import { ToolUseCard } from "./ToolUseCard";

export interface TodoItem {
  id?: string;
  content?: string;
  status?: string;
  priority?: string;
}

interface TodoWriteToolInput {
  todos?: TodoItem[];
}

interface Props {
  toolId: string;
  input: TodoWriteToolInput;
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

export const TodoWriteToolRenderer = memo(function TodoWriteToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");
  const todos = input.todos ?? [];

  return (
    <ToolUseCard
      title={t("tools.todoWrite")}
      icon={<ListTodo className={cn(layout.iconSize, styles.icon)} />}
      variant="task"
      toolId={toolId}
      rightContent={
        <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
          {t("taskOperation.itemCount", { count: todos.length })}
        </span>
      }
    >
      <TodoWriteList todos={todos} />
    </ToolUseCard>
  );
});
