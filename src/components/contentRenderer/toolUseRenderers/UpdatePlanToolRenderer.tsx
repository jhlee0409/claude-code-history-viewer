import { memo } from "react";
import { ListChecks, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { TASK_STATUS_CONFIG } from "@/components/toolResultRenderer/taskStatusConfig";
import { ToolUseCard } from "./ToolUseCard";

interface PlanStep {
  step?: string;
  status?: string;
}

interface UpdatePlanToolInput {
  explanation?: string;
  plan?: PlanStep[];
}

interface Props {
  toolId: string;
  input: UpdatePlanToolInput;
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

export const UpdatePlanToolRenderer = memo(function UpdatePlanToolRenderer({
  toolId,
  input,
}: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("task");
  const steps = input.plan ?? [];

  return (
    <ToolUseCard
      title={t("tools.taskUpdate")}
      icon={<ListChecks className={cn(layout.iconSize, styles.icon)} />}
      variant="task"
      toolId={toolId}
      rightContent={
        <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
          {t("taskOperation.taskCount", { count: steps.length })}
        </span>
      }
    >
      <div className="space-y-1.5">
        {input.explanation && (
          <div className={cn("p-2 border border-border bg-card", layout.rounded, layout.bodyText, "text-foreground whitespace-pre-wrap")}>
            {input.explanation}
          </div>
        )}
        {steps.map((planStep, index) => {
          const status = planStep.status ?? "pending";
          const statusConfig = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG.pending;
          const StatusIcon = statusConfig.icon ?? Circle;

          return (
            <div
              key={`${status}-${index}`}
              className={cn("p-2 border border-border bg-card", layout.rounded, "space-y-1")}
            >
              <div className={cn("flex items-center gap-1.5", layout.smallText)}>
                <StatusIcon className={cn(layout.iconSizeSmall, statusConfig.color ?? "text-muted-foreground")} />
                <span className={cn("font-medium", statusConfig.color ?? "text-muted-foreground")}>
                  {t(getStatusLabelKey(status))}
                </span>
              </div>
              <div className={cn(layout.bodyText, "text-foreground")}>
                {planStep.step ?? ""}
              </div>
            </div>
          );
        })}
      </div>
    </ToolUseCard>
  );
});
