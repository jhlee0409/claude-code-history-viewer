import { memo } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { ToolUseCard, ToolUsePropertyRow } from "./ToolUseCard";

interface TaskToolInput {
  description?: string;
  prompt?: string;
  subagent_type?: string;
  run_in_background?: boolean;
}

interface Props {
  toolId: string;
  input: TaskToolInput;
}

export const TaskToolRenderer = memo(function TaskToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");

  const hasMeta =
    Boolean(input.subagent_type) || typeof input.run_in_background === "boolean";
  const hasBody = Boolean(input.description) || Boolean(input.prompt);

  return (
    <ToolUseCard
      title={t("toolUseRenderer.task")}
      icon={<MessageSquare className={cn(layout.iconSize, styles.icon)} />}
      variant="task"
      toolId={toolId}
    >
      {hasMeta && (
        <div className="mb-2 space-y-1">
          {input.subagent_type && (
            <ToolUsePropertyRow label={t("taskOperation.subagent")}>
              <span className={cn(layout.bodyText, "text-foreground")}>{input.subagent_type}</span>
            </ToolUsePropertyRow>
          )}
          {typeof input.run_in_background === "boolean" && (
            <ToolUsePropertyRow label={t("taskOperation.background")}>
              <code className={cn(layout.bodyText, "text-foreground")}>
                {String(input.run_in_background)}
              </code>
            </ToolUsePropertyRow>
          )}
        </div>
      )}

      {input.description && (
        <div className={cn("p-2 border bg-card border-border mb-2", layout.rounded)}>
          <div className={cn(layout.smallText, "text-muted-foreground mb-0.5")}>
            {t("taskOperation.description")}
          </div>
          <div className={cn(layout.bodyText, "text-foreground whitespace-pre-wrap")}>
            {input.description}
          </div>
        </div>
      )}

      {input.prompt && (
        <div className={cn("p-2 border bg-card border-border", layout.rounded)}>
          <div className={cn(layout.smallText, "text-muted-foreground mb-0.5")}>
            {t("taskOperation.prompt")}
          </div>
          <div className={cn(layout.bodyText, "text-foreground whitespace-pre-wrap")}>
            {input.prompt}
          </div>
        </div>
      )}

      {!hasMeta && !hasBody && (
        <pre className={cn("p-2 border bg-card border-border overflow-auto", layout.rounded, layout.smallText)}>
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </ToolUseCard>
  );
});
