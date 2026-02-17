/**
 * ActivityHeatmap Component
 *
 * Clean heatmap grid with simple tooltips.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipTrigger } from "../../ui/tooltip";
import { ChartTooltip } from "../../ui/chart-tooltip";
import { cn } from "@/lib/utils";
import type { ActivityHeatmap } from "../../../types";
import { formatNumber, getHeatColor } from "../utils";

interface ActivityHeatmapProps {
  data: ActivityHeatmap[];
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const ActivityHeatmapComponent: React.FC<ActivityHeatmapProps> = ({ data }) => {
  const { t } = useTranslation();
  const maxActivity = Math.max(...data.map((d) => d.activity_count), 1);
  const days = t("analytics.weekdayNames", { returnObjects: true }) as string[];

  const hourTotals = useMemo(() => {
    const totals = HOURS.map(hour => {
      const hourData = data.filter(d => d.hour === hour);
      return {
        hour,
        total: hourData.reduce((sum, d) => sum + d.activity_count, 0),
      };
    });
    return totals;
  }, [data]);

  const peakHour = hourTotals.length > 0
    ? hourTotals.reduce((max, h) => h.total > max.total ? h : max, hourTotals[0]!)
    : { hour: 0, total: 0 };

  const cellStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      for (const hour of HOURS) {
        const activity = data.find((d) => d.hour === hour && d.day === dayIndex);
        const intensity = activity ? activity.activity_count / maxActivity : 0;
        const heatColor = getHeatColor(intensity);
        const isNightHour = hour < 6 || hour >= 22;
        styles[`${dayIndex}-${hour}`] = {
          backgroundColor: heatColor,
          opacity: isNightHour && intensity === 0 ? 0.5 : 1,
        };
      }
    }
    return styles;
  }, [data, maxActivity]);

  return (
    <div className="space-y-4">
      {/* Main Grid */}
      <div className="overflow-x-auto scrollbar-thin">
        <div className="inline-block min-w-max">
          {/* Hour labels */}
          <div className="flex gap-px mb-1 ml-10">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className={cn(
                  "w-4 h-5 flex items-end justify-center text-[8px] font-mono",
                  hour === peakHour.hour ? "text-metric-green font-semibold" : "text-muted-foreground/40"
                )}
              >
                {hour % 3 === 0 ? hour.toString().padStart(2, "0") : ""}
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          {days.map((day, dayIndex) => {
            const dayTotal = data
              .filter(d => d.day === dayIndex)
              .reduce((sum, d) => sum + d.activity_count, 0);

            return (
              <div key={day} className="flex gap-px mb-px">
                <div
                  className={cn(
                    "w-10 flex items-center justify-end pr-2 text-[9px] font-medium uppercase tracking-wider",
                    dayTotal > 0 ? "text-foreground/70" : "text-muted-foreground/40"
                  )}
                >
                  {day}
                </div>

                {HOURS.map((hour) => {
                  const activity = data.find((d) => d.hour === hour && d.day === dayIndex);
                  const intensity = activity ? activity.activity_count / maxActivity : 0;
                  const tokens = activity?.tokens_used || 0;
                  const styleKey = `${dayIndex}-${hour}`;

                  return (
                    <Tooltip key={`${day}-${hour}`}>
                      <TooltipTrigger>
                        <div
                          className={cn(
                            "w-4 h-4 cursor-pointer rounded-sm",
                            "transition-transform duration-150",
                            "hover:scale-125 hover:z-10",
                            intensity > 0 && "hover:ring-1 hover:ring-white/30"
                          )}
                          style={cellStyles[styleKey]}
                        />
                      </TooltipTrigger>
                      <ChartTooltip
                        title={`${day} • ${hour.toString().padStart(2, "0")}:00`}
                        rows={[
                          { label: t("analytics.tooltip.activities"), value: activity?.activity_count || 0, color: intensity > 0.3 ? "var(--metric-green)" : undefined },
                          { label: t("analytics.tooltip.tokens"), value: formatNumber(tokens) },
                        ]}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend + Peak */}
      <div className="flex items-center justify-between pt-3 border-t border-border/30">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-medium text-muted-foreground">
            {t("analytics.legend.less")}
          </span>
          <div className="flex gap-0.5">
            {[0, 0.25, 0.5, 0.75, 1].map((intensity) => (
              <div
                key={intensity}
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: getHeatColor(intensity) }}
              />
            ))}
          </div>
          <span className="text-[9px] font-medium text-muted-foreground">
            {t("analytics.legend.more")}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-metric-green" />
          <span className="text-[9px] font-mono text-muted-foreground">
            Peak: <span className="text-metric-green font-medium">{peakHour.hour.toString().padStart(2, "0")}:00</span>
            <span className="text-muted-foreground/60 ml-1">({peakHour.total})</span>
          </span>
        </div>
      </div>
    </div>
  );
};

ActivityHeatmapComponent.displayName = "ActivityHeatmapComponent";
