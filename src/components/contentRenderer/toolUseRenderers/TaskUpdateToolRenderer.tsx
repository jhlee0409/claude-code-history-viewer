import { memo } from "react";
import { ListChecks, ArrowRight, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { TASK_STATUS_CONFIG } from "@/components/toolResultRenderer/taskStatusConfig";
import { ToolUseCard, ToolUsePropertyRow } from "./ToolUseCard";

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

export const TaskUpdateToolRenderer = memo(function TaskUpdateToolRenderer({ toolId, input }: Props) {
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

  const statusInfo = input.status ? TASK_STATUS_CONFIG[input.status] : null;
  const defaultConfig = TASK_STATUS_CONFIG["pending"];
  const StatusIcon = statusInfo?.icon ?? defaultConfig?.icon ?? Circle;

  return (
    <ToolUseCard
      title={t("tools.taskUpdate")}
      icon={<ListChecks className={cn(layout.iconSize, styles.icon)} />}
      variant="task"
      toolId={toolId}
      rightContent={
        input.taskId ? (
          <span className={cn("px-1.5 py-0.5 font-mono", layout.rounded, styles.badge, styles.badgeText)}>
            {t("rendererLabels.task")} #{input.taskId}
          </span>
        ) : null
      }
    >
      <div className={cn("space-y-1.5")}>
        {input.status && statusInfo && (
          <ToolUsePropertyRow label={t("rendererLabels.status")} className="items-center">
            <ArrowRight className={cn(layout.iconSizeSmall, "text-muted-foreground")} />
            <div className={cn("flex items-center gap-1 px-1.5 py-0.5", layout.rounded, "bg-card border border-border")}>
              <StatusIcon className={cn(layout.iconSizeSmall, statusInfo.color)} />
              <span className={cn(layout.bodyText, "font-medium", statusInfo.color)}>{getStatusLabel(input.status)}</span>
            </div>
          </ToolUsePropertyRow>
        )}
        {input.subject && (
          <ToolUsePropertyRow label={t("rendererLabels.subject")}>
            <span className={cn(layout.bodyText, "text-foreground")}>{input.subject}</span>
          </ToolUsePropertyRow>
        )}
        {input.owner && (
          <ToolUsePropertyRow label={t("rendererLabels.owner")} className="items-center">
            <code className={cn(layout.bodyText, "font-mono text-foreground")}>{input.owner}</code>
          </ToolUsePropertyRow>
        )}
        {input.addBlocks && input.addBlocks.length > 0 && (
          <ToolUsePropertyRow label={t("rendererLabels.blocks")} className="items-center">
            <div className="flex gap-1">
              {input.addBlocks.map((id) => (
                <span key={id} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-muted text-muted-foreground")}>
                  #{id}
                </span>
              ))}
            </div>
          </ToolUsePropertyRow>
        )}
        {input.addBlockedBy && input.addBlockedBy.length > 0 && (
          <ToolUsePropertyRow label={t("rendererLabels.blockedBy")} className="items-center">
            <div className="flex gap-1">
              {input.addBlockedBy.map((id) => (
                <span key={id} className={cn("px-1.5 py-0.5 font-mono", layout.smallText, layout.rounded, "bg-muted text-muted-foreground")}>
                  #{id}
                </span>
              ))}
            </div>
          </ToolUsePropertyRow>
        )}
      </div>
    </ToolUseCard>
  );
});
