import { memo } from "react";
import { ListPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface TaskCreateToolInput {
  subject?: string;
  description?: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

interface Props {
  toolId: string;
  input: TaskCreateToolInput;
}

export const TaskCreateToolRenderer = memo(function TaskCreateToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.taskCreate", { defaultValue: "TaskCreate" })}
        icon={<ListPlus className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          toolId && (
            <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
              ID: {toolId}
            </code>
          )
        }
      />
      <Renderer.Content>
        {input.subject && (
          <div className={cn("p-2 border bg-card border-border", layout.rounded, "mb-2")}>
            <div className={cn(layout.smallText, "text-muted-foreground mb-0.5")}>{t("taskOperation.subject")}</div>
            <div className={cn(layout.bodyText, "text-foreground font-medium")}>{input.subject}</div>
          </div>
        )}
        {input.description && (
          <div className={cn("p-2 border bg-card border-border", layout.rounded, "mb-2")}>
            <div className={cn(layout.smallText, "text-muted-foreground mb-0.5")}>{t("taskOperation.description")}</div>
            <div className={cn(layout.bodyText, "text-foreground whitespace-pre-wrap")}>{input.description}</div>
          </div>
        )}
        {input.activeForm && (
          <div className={cn("flex items-center gap-2", layout.smallText, "text-muted-foreground")}>
            <span>{t("taskOperation.activeForm")}</span>
            <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
              {input.activeForm}
            </span>
          </div>
        )}
      </Renderer.Content>
    </Renderer>
  );
});
