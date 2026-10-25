import { memo } from "react";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { TASK_STATUS_CONFIG } from "@/components/toolResultRenderer/taskStatusConfig";
import { Marked, type TextHighlight } from "../../transcript/ToolRow";
import { ToolUseCard } from "./ToolUseCard";

interface PlanStep {
  step?: string;
  status?: string;
}

export interface UpdatePlanToolInput {
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
      <UpdatePlanSteps input={input} />
    </ToolUseCard>
  );
});
