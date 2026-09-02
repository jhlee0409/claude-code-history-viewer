import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getModelLifecycle } from "./AnalyticsDashboard/utils/calculations";

interface ModelLifecycleBadgeProps {
  model: string;
  /** Drop the date from the label for dense rows; the tooltip keeps it. */
  compact?: boolean;
  className?: string;
}

/**
 * Small pill shown next to a model id when the provider has retired it or
 * announced a shutdown within the notice window. Renders nothing for active
 * or unknown models so callers can drop it in unconditionally.
 */
export const ModelLifecycleBadge: React.FC<ModelLifecycleBadgeProps> = ({ model, compact = false, className }) => {
  const { t } = useTranslation();
  const lifecycle = getModelLifecycle(model);
  if (!lifecycle || lifecycle.status === "active") return null;

  const retired = lifecycle.status === "retired";
  const label = compact
    ? retired
      ? t("common.modelLifecycle.retiredShort", "retired")
      : t("common.modelLifecycle.retiringShort", "retiring")
    : retired
      ? t("common.modelLifecycle.retired", { date: lifecycle.deprecatedAt, defaultValue: "retired {{date}}" })
      : t("common.modelLifecycle.retiring", { date: lifecycle.deprecatedAt, defaultValue: "retires {{date}}" });
  const hint = [
    retired
      ? t("common.modelLifecycle.retiredHint", { date: lifecycle.deprecatedAt, defaultValue: "The provider shut this model down on {{date}}. New requests to it fail." })
      : t("common.modelLifecycle.retiringHint", { date: lifecycle.deprecatedAt, defaultValue: "The provider will shut this model down on {{date}}." }),
    lifecycle.replacedBy
      ? t("common.modelLifecycle.replacement", { model: lifecycle.replacedBy, defaultValue: "Recommended replacement: {{model}}" })
      : null,
  ].filter(Boolean).join(" ");

  return (
    <span
      title={hint}
      // The title is mouse-only; give assistive tech the same sentence.
      aria-label={`${label}. ${hint}`}
      className={cn(
        "inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-px10 uppercase tracking-wide whitespace-nowrap",
        retired
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      {label}
    </span>
  );
};
