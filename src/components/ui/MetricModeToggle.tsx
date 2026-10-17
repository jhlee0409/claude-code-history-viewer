import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MetricMode } from "../../types";

interface MetricModeToggleProps {
  value: MetricMode;
  onChange: (mode: MetricMode) => void;
  className?: string;
}

const MODES: Array<{ id: MetricMode; labelKey: string; fallback: string }> = [
  { id: "tokens", labelKey: "analytics.metricModeTokens", fallback: "Tokens" },
  {
    id: "cost_estimated",
    labelKey: "analytics.metricModeCostEstimated",
    fallback: "Cost (Est.)",
  },
];

export const MetricModeToggle: React.FC<MetricModeToggleProps> = ({
  value,
  onChange,
  className,
}) => {
  const { t } = useTranslation();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-caption text-muted-foreground whitespace-nowrap">
        {t("analytics.metricModeLabel", "Metric")}
      </span>
      <div className="segmented">
        {MODES.map((mode) => {
          const active = value === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(mode.id)}
              className="segmented-item px-3 py-1.5 text-caption"
            >
              {t(mode.labelKey, mode.fallback)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

MetricModeToggle.displayName = "MetricModeToggle";
