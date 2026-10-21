import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { ChartTooltip } from "../ui/chart-tooltip";
import { cn } from "@/lib/utils";
import type { DailyBar } from "./useActivityData";
import { useFormat } from "@/lib/format/useFormat";

interface ContributionGridProps {
  dailyBars: DailyBar[];
  onDateClick: (date: string) => void;
  onDateClear: () => void;
  selectedDate: string | null;
}

// Layout constants
const BAR_WIDTH = 14;
const BAR_GAP = 3;
const SLOT_WIDTH = BAR_WIDTH + BAR_GAP;
const CHART_HEIGHT = 80;
const AXIS_HEIGHT = 18;
const GRID_LINES = 4; // horizontal reference lines
const MIN_LABEL_GAP_PX = 44; // minimum pixel distance between label centres

// Bar color ramp using the app's heatmap CSS variables.
// Zero-day bars use a subtly visible "empty" tick.
function getBarColor(intensity: number, isSelected: boolean): string {
  if (isSelected) return "var(--accent)"; // brand accent when active
  if (intensity === 0) return "var(--heatmap-empty)";
  if (intensity <= 0.33) return "var(--heatmap-low)";
  if (intensity <= 0.66) return "var(--heatmap-medium)";
  return "var(--heatmap-high)";
}


/**
 * Select which bar indices should receive an axis label.
 * Algorithm: greedy left-to-right scan, always include first and last,
 * enforce a hard pixel-distance floor so labels never collide.
 */
function selectLabelIndices(count: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [0];

  const minSlots = Math.ceil(MIN_LABEL_GAP_PX / SLOT_WIDTH);
  const indices: number[] = [0];

  for (let i = 1; i < count - 1; i++) {
    const last = indices[indices.length - 1] ?? 0;
    if (i - last >= minSlots) {
      indices.push(i);
    }
  }

  // Always include last if it won't collide with the previous label
  const last = indices[indices.length - 1] ?? 0;
  const lastIdx = count - 1;
  if (lastIdx > last && lastIdx - last >= Math.max(2, Math.floor(minSlots * 0.55))) {
    indices.push(lastIdx);
  }

  return indices;
}

export const ContributionGrid: React.FC<ContributionGridProps> = ({
  dailyBars,
  onDateClick,
  onDateClear,
  selectedDate,
}) => {
  const { t } = useTranslation();
  const fmt = useFormat();

  const maxCount = useMemo(() => {
    let max = 0;
    for (const bar of dailyBars) {
      if (bar.sessionCount > max) max = bar.sessionCount;
    }
    return max;
  }, [dailyBars]);

  const labelIndices = useMemo(
    () => selectLabelIndices(dailyBars.length),
    [dailyBars.length]
  );

  if (dailyBars.length === 0) {
    return (
      <div className="text-list text-muted-foreground py-2 text-center">
        {t("analytics.timeline.noActivity")}
      </div>
    );
  }

  const handleBarClick = (bar: DailyBar) => {
    if (bar.sessionCount === 0) return;
    if (selectedDate === bar.date) {
      onDateClear();
    } else {
      onDateClick(bar.date);
    }
  };

  const handleBarKeyDown = (e: React.KeyboardEvent, bar: DailyBar) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBarClick(bar);
    }
  };

  const totalWidth = dailyBars.length * SLOT_WIDTH - BAR_GAP;
  const svgHeight = CHART_HEIGHT + AXIS_HEIGHT;

  // Grid line Y positions (evenly spaced inside the chart area)
  const gridYPositions = Array.from({ length: GRID_LINES }, (_, i) =>
    Math.round(CHART_HEIGHT - (CHART_HEIGHT * (i + 1)) / (GRID_LINES + 1))
  );

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto scrollbar-thin">
        {/* SVG wrapper gives us a true proportional coordinate system */}
        <svg
          width={totalWidth}
          height={svgHeight}
          aria-label={t("analytics.timeline.title")}
          style={{ display: "block", overflow: "visible" }}
        >
          {/* ── Subtle horizontal grid lines ── */}
          {gridYPositions.map((y) => (
            <line
              key={y}
              x1={0}
              y1={y}
              x2={totalWidth}
              y2={y}
              stroke="var(--border)"
              strokeWidth={0.5}
              strokeOpacity={0.45}
              strokeDasharray="2 3"
            />
          ))}

          {/* ── Baseline ── */}
          <line
            x1={0}
            y1={CHART_HEIGHT}
            x2={totalWidth}
            y2={CHART_HEIGHT}
            stroke="var(--border)"
            strokeWidth={0.75}
            strokeOpacity={0.6}
          />

          {/* ── Bars (rendered as foreignObject so Tooltip works) ── */}
          {dailyBars.map((bar, idx) => {
            const intensity = maxCount > 0 ? bar.sessionCount / maxCount : 0;
            const barPixelHeight =
              bar.sessionCount > 0
                ? Math.max(3, Math.round(intensity * (CHART_HEIGHT - 4)))
                : 2; // zero-day stub: 2px tick for visual presence
            const x = idx * SLOT_WIDTH;
            const y = CHART_HEIGHT - barPixelHeight;
            const isSelected = selectedDate === bar.date;
            const isClickable = bar.sessionCount > 0;
            const fillColor = getBarColor(intensity, isSelected);

            return (
              <Tooltip key={bar.date}>
                <TooltipTrigger asChild>
                  {/* foreignObject lets us keep the existing Tooltip/TooltipTrigger
                      system which requires a DOM element, not an SVG rect */}
                  <foreignObject
                    x={x}
                    y={y}
                    width={BAR_WIDTH}
                    height={barPixelHeight}
                    style={{ overflow: "visible" }}
                  >
                    <div
                      role={isClickable ? "button" : undefined}
                      tabIndex={isClickable ? 0 : -1}
                      aria-hidden={!isClickable ? true : undefined}
                      aria-label={
                        isClickable
                          ? `${fmt.dayKey(bar.date, "short")}: ${t(
                              bar.sessionCount === 1
                                ? "analytics.timeline.session"
                                : "analytics.timeline.sessions",
                              { count: bar.sessionCount }
                            )}`
                          : undefined
                      }
                      aria-pressed={isSelected ? true : undefined}
                      className={cn(
                        "w-full h-full rounded-t-[2px]",
                        "transition-opacity duration-100",
                        isClickable && "cursor-pointer hover:opacity-75",
                        isSelected &&
                          "ring-1 ring-offset-[1px] ring-offset-background ring-accent"
                      )}
                      style={{
                        backgroundColor: fillColor,
                        // Zero-day stubs are barely visible — not clickable
                        opacity: bar.sessionCount === 0 ? 0.3 : 1,
                        // Selected bar gets a faint glow
                        boxShadow: isSelected
                          ? "0 0 6px var(--accent)"
                          : undefined,
                      }}
                      onClick={isClickable ? () => handleBarClick(bar) : undefined}
                      onKeyDown={
                        isClickable ? (e) => handleBarKeyDown(e, bar) : undefined
                      }
                    />
                  </foreignObject>
                </TooltipTrigger>
                <ChartTooltip
                  title={fmt.dayKey(bar.date, "short")}
                  rows={
                    bar.sessionCount > 0
                      ? [
                          {
                            label: t("analytics.tooltip.sessions"),
                            value: bar.sessionCount,
                          },
                        ]
                      : undefined
                  }
                  subtitle={
                    bar.sessionCount === 0
                      ? t("analytics.timeline.noActivity")
                      : undefined
                  }
                />
              </Tooltip>
            );
          })}

          {/* ── Axis labels — pixel-positioned, never collide ── */}
          {labelIndices.map((idx) => {
            const bar = dailyBars[idx];
            if (!bar) return null;
            // Centre of the bar slot
            const cx = idx * SLOT_WIDTH + BAR_WIDTH / 2;
            return (
              <text
                key={bar.date}
                x={cx}
                y={CHART_HEIGHT + AXIS_HEIGHT - 3}
                textAnchor="middle"
                style={{ fontSize: "var(--text-caption)" }}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fill="var(--muted-foreground)"
                opacity={0.6}
                aria-hidden="true"
              >
                {fmt.dayKey(bar.date, "numeric")}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

ContributionGrid.displayName = "ContributionGrid";
