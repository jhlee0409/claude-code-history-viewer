import { Clipboard, Circle, CheckCircle, MinusCircle, X } from "lucide-react";
import { Renderer } from "../../shared/RendererHeader";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { layout } from "@/components/renderers";
import { HighlightedText } from "../common/HighlightedText";

type Props = {
  todoData: Record<string, unknown>;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
};

export const TodoUpdateRenderer = ({
  todoData,
  searchQuery,
  isCurrentMatch = false,
  currentMatchIndex = 0,
}: Props) => {
  const { t } = useTranslation();
  const newTodos = Array.isArray(todoData.newTodos) ? todoData.newTodos : [];

  const getTodoStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className={cn(layout.iconSize, "text-success")} />;
      case "in_progress":
        return <MinusCircle className={cn(layout.iconSize, "text-warning")} />;
      case "pending":
        return <Circle className={cn(layout.iconSize, "text-muted-foreground")} />;
      default:
        return <X className={cn(layout.iconSize, "text-muted-foreground")} />;
    }
  };

  return (
    <Renderer className="bg-tool-task/10 border-tool-task/30">
      <Renderer.Header
        title={t("tools.todoUpdate")}
        icon={<Clipboard className={cn(layout.iconSize, "text-tool-task")} />}
        titleClassName="text-tool-task"
      />
      <Renderer.Content>
        {newTodos.length > 0 && (
          <div>
            <div className={`${layout.smallText} font-medium mb-1 text-muted-foreground`}>
              {t("tools.currentStatus")}
            </div>
            <div className="space-y-1">
              {newTodos.map(
                (
                  todo: { content: string; status: string; priority: string },
                  idx: number
                ) => (
                  <div
                    key={idx}
                    className={cn("flex items-center", layout.iconSpacing, layout.bodyText)}
                  >
                    {getTodoStatusIcon(todo.status)}
                    <span
                      className={cn(
                        todo.status === "completed"
                          ? "line-through text-foreground"
                          : "text-foreground"
                      )}
                    >
                      {searchQuery ? (
                        <HighlightedText
                          text={todo.content}
                          searchQuery={searchQuery}
                          isCurrentMatch={isCurrentMatch}
                          currentMatchIndex={currentMatchIndex}
                        />
                      ) : (
                        todo.content
                      )}
                    </span>
                    <span className={`${layout.smallText} text-muted-foreground`}>
                      ({todo.priority})
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
};
