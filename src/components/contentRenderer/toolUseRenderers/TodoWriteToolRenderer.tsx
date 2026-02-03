import { ListTodo, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface TodoItem {
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
      return <CheckCircle2 className={cn(layout.iconSizeSmall, "text-success shrink-0")} />;
    case "in_progress":
      return <Loader2 className={cn(layout.iconSizeSmall, "text-info shrink-0")} />;
    default:
      return <Circle className={cn(layout.iconSizeSmall, "text-muted-foreground shrink-0")} />;
  }
};

export const TodoWriteToolRenderer = ({ toolId, input }: Props) => {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");
  const todos = input.todos ?? [];

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.todoWrite", { defaultValue: "TodoWrite" })}
        icon={<ListTodo className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
              {t("taskOperation.itemCount", { count: todos.length })}
            </span>
            {toolId && (
              <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                ID: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className="space-y-1">
          {todos.map((todo, i) => (
            <div
              key={todo.id ?? i}
              className={cn("flex items-start gap-2 p-1.5 border border-border", layout.rounded, "bg-card")}
            >
              <StatusIcon status={todo.status} />
              <div className="min-w-0 flex-1">
                <span className={cn(layout.bodyText, "text-foreground")}>
                  {todo.content ?? JSON.stringify(todo)}
                </span>
                {todo.priority && todo.priority !== "medium" && (
                  <span className={cn(
                    "ml-2 px-1 py-0.5 font-mono", layout.smallText, layout.rounded,
                    todo.priority === "high" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"
                  )}>
                    {todo.priority}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
