import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipTrigger,
} from "../ui/tooltip";
import { ChartTooltip } from "../ui/chart-tooltip";
import { cn } from "@/lib/utils";
import { getHeatColor } from "../AnalyticsDashboard/utils/calculations";
import type { DailyBar } from "./useActivityData";

interface ContributionGridProps {
  dailyBars: DailyBar[];
  onDateClick: (date: string) => void;
  onDateClear: () => void;
  selectedDate: string | null;
}

const BAR_HEIGHT = 96;
const BAR_WIDTH = 18;
const BAR_GAP = 4;

export const ContributionGrid: React.FC<ContributionGridProps> = ({
  dailyBars,
  onDateClick,
  onDateClear,
  selectedDate,
}) => {
  const { t } = useTranslation();

  const maxCount = useMemo(() => {
    let max = 0;
    for (const bar of dailyBars) {
      if (bar.sessionCount > max) max = bar.sessionCount;
    }
    return max;
  }, [dailyBars]);

  // Determine which date labels to show (avoid overcrowding)
  const labelIndices = useMemo(() => {
    const count = dailyBars.length;
    if (count <= 7) return dailyBars.map((_, i) => i);
    // Show ~5-8 evenly spaced labels
    const step = Math.max(1, Math.floor(count / 6));
    const indices: number[] = [0];
    for (let i = step; i < count - 1; i += step) {
      indices.push(i);
    }
    // Only add last index if it's far enough from the previous label
    const lastIdx = count - 1;
    const prevIdx = indices[indices.length - 1] ?? 0;
    if (lastIdx - prevIdx >= step) {
      indices.push(lastIdx);
    }
    return indices;
  }, [dailyBars]);

  if (dailyBars.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2 text-center">
        {t("analytics.timeline.noActivity")}
      </div>
    );
  }

  const handleBarClick = (date: string) => {
    if (selectedDate === date) {
      onDateClear();
    } else {
      onDateClick(date);
    }
  };

  const handleBarKeyDown = (e: React.KeyboardEvent, date: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBarClick(date);
    }
  };

  const formatDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      {/* Bar chart */}
      <div className="overflow-x-auto scrollbar-thin">
        <div
          className="flex items-end"
          style={{
            height: `${BAR_HEIGHT}px`,
            gap: `${BAR_GAP}px`,
            minWidth: "fit-content",
          }}
        >
          {dailyBars.map((bar) => {
            const intensity = maxCount > 0 ? bar.sessionCount / maxCount : 0;
            const barPixelHeight = Math.max(
              bar.sessionCount > 0 ? 3 : 0,
              Math.round(intensity * (BAR_HEIGHT - 4))
            );
            const isSelected = selectedDate === bar.date;

            return (
              <Tooltip key={bar.date}>
                <TooltipTrigger asChild>
                  <div
                    role="button"
                    tabIndex={bar.sessionCount > 0 ? 0 : -1}
                    aria-hidden={bar.sessionCount === 0 ? true : undefined}
                    aria-label={`${formatDateLabel(bar.date)}: ${t(bar.sessionCount === 1 ? "analytics.timeline.session" : "analytics.timeline.sessions", { count: bar.sessionCount })}`}
                    className={cn(
                      "shrink-0 rounded-t-sm transition-all duration-100",
                      bar.sessionCount > 0 && "cursor-pointer hover:opacity-80",
                      isSelected && "ring-1 ring-primary ring-offset-1 ring-offset-background"
                    )}
                    style={{
                      width: `${BAR_WIDTH}px`,
                      height: `${barPixelHeight}px`,
                      backgroundColor: bar.sessionCount > 0
                        ? getHeatColor(Math.max(0.25, intensity))
                        : "transparent",
                    }}
                    onClick={bar.sessionCount > 0 ? () => handleBarClick(bar.date) : undefined}
                    onKeyDown={bar.sessionCount > 0 ? (e) => handleBarKeyDown(e, bar.date) : undefined}
                  />
                </TooltipTrigger>
                <ChartTooltip
                  title={formatDateLabel(bar.date)}
                  rows={bar.sessionCount > 0 ? [
                    { label: t("analytics.tooltip.sessions"), value: bar.sessionCount },
                  ] : undefined}
                  subtitle={bar.sessionCount === 0 ? t("analytics.timeline.noActivity") : undefined}
                />
              </Tooltip>
            );
          })}
        </div>

        {/* Date labels */}
        <div
          className="flex relative"
          style={{
            gap: `${BAR_GAP}px`,
            minWidth: "fit-content",
          }}
        >
          {dailyBars.map((bar, i) => {
            const showLabel = labelIndices.includes(i);
            return (
              <div
                key={bar.date}
                className="shrink-0 text-[10px] text-muted-foreground/70"
                style={{
                  width: `${BAR_WIDTH}px`,
                  textAlign: "center",
                  overflow: "visible",
                  whiteSpace: "nowrap",
                }}
              >
                {showLabel ? (
                  <span className="relative" style={{ left: "-50%", display: "inline-block", transform: "translateX(50%)" }}>
                    {formatDateLabel(bar.date)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

ContributionGrid.displayName = "ContributionGrid";
