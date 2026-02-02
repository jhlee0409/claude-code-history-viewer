import { ListChecks, CheckCircle2, Circle, Loader2, Trash2, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";

interface TaskUpdateToolInput {
  taskId?: string;
  status?: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

interface Props {
  toolId: string;
  input: TaskUpdateToolInput;
}

const STATUS_STYLES: Record<string, { icon: typeof Circle; color: string; label: string }> = {
  pending: { icon: Circle, color: "text-muted-foreground", label: "Pending" },
  in_progress: { icon: Loader2, color: "text-info", label: "In Progress" },
  completed: { icon: CheckCircle2, color: "text-success", label: "Completed" },
  deleted: { icon: Trash2, color: "text-destructive", label: "Deleted" },
};

export const TaskUpdateToolRenderer = ({ toolId, input }: Props) => {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");
  const statusInfo = input.status ? STATUS_STYLES[input.status] : null;
  const StatusIcon = statusInfo?.icon ?? Circle;

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.taskUpdate", { defaultValue: "TaskUpdate" })}
        icon={<ListChecks className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {input.taskId && (
              <span className={cn("px-1.5 py-0.5 font-mono", layout.rounded, styles.badge, styles.badgeText)}>
                Task #{input.taskId}
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
        <div className={cn("space-y-1.5")}>
          {input.status && statusInfo && (
            <div className="flex items-center gap-2">
              <ArrowRight className={cn(layout.iconSizeSmall, "text-muted-foreground")} />
              <span className={cn(layout.smallText, "text-muted-foreground")}>status:</span>
              <div className={cn("flex items-center gap-1 px-1.5 py-0.5", layout.rounded, "bg-card border border-border")}>
                <StatusIcon className={cn(layout.iconSizeSmall, statusInfo.color)} />
                <span className={cn(layout.bodyText, "font-medium", statusInfo.color)}>{statusInfo.label}</span>
              </div>
            </div>
          )}
          {input.subject && (
            <div className="flex items-start gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground shrink-0 pt-0.5")}>subject:</span>
              <span className={cn(layout.bodyText, "text-foreground")}>{input.subject}</span>
            </div>
          )}
          {input.owner && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground")}>owner:</span>
              <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.owner}</code>
            </div>
          )}
          {input.addBlocks && input.addBlocks.length > 0 && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground")}>blocks:</span>
              <div className="flex gap-1">
                {input.addBlocks.map((id) => (
                  <span key={id} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-muted text-muted-foreground")}>
                    #{id}
                  </span>
                ))}
              </div>
            </div>
          )}
          {input.addBlockedBy && input.addBlockedBy.length > 0 && (
            <div className="flex items-center gap-2">
              <span className={cn(layout.smallText, "text-muted-foreground")}>blocked by:</span>
              <div className="flex gap-1">
                {input.addBlockedBy.map((id) => (
                  <span key={id} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-muted text-muted-foreground")}>
                    #{id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
