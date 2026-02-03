import { memo } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface TaskOutputToolInput {
  task_id?: string;
  block?: boolean;
  timeout?: number;
}

interface Props {
  toolId: string;
  input: TaskOutputToolInput;
}

export const TaskOutputToolRenderer = memo(function TaskOutputToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("taskOperation.taskOutput")}
        icon={<Download className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {input.task_id && (
              <span className={cn("px-1.5 py-0.5 font-mono", layout.rounded, styles.badge, styles.badgeText)}>
                Task {input.task_id}
              </span>
            )}
            {toolId && (
              <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                ID: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className={cn("flex items-center gap-3", layout.smallText, "text-muted-foreground")}>
          {input.block != null && (
            <span>block: <code className="text-foreground">{String(input.block)}</code></span>
          )}
          {input.timeout != null && (
            <span>timeout: <code className="text-foreground">{(input.timeout / 1000).toFixed(0)}s</code></span>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
});
