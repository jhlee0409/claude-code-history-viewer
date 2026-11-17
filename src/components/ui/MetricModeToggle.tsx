import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Segmented, SegmentedItem } from "./segmented";
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
      <Segmented value={value} onValueChange={(mode) => onChange(mode as MetricMode)} aria-label={t("analytics.metricModeLabel", "Metric")} size="toolbar">
        {MODES.map((mode) => (
          <SegmentedItem key={mode.id} value={mode.id}>
            {t(mode.labelKey, mode.fallback)}
          </SegmentedItem>
        ))}
      </Segmented>
    </div>
  );
};

MetricModeToggle.displayName = "MetricModeToggle";
