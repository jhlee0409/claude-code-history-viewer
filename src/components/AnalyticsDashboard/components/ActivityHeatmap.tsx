/**
 * ActivityHeatmap Component
 *
 * Displays activity heatmap by hour and day of week.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "@/lib/utils";
import { layout } from "../../renderers";
import type { ActivityHeatmap } from "../../../types";
import { formatNumber, getHeatColor } from "../utils";

interface ActivityHeatmapProps {
  data: ActivityHeatmap[];
}

export const ActivityHeatmapComponent: React.FC<ActivityHeatmapProps> = ({ data }) => {
  const { t } = useTranslation();
  const maxActivity = Math.max(...data.map((d) => d.activity_count), 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = t("analytics.weekdayNames", { returnObjects: true }) as string[];

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-max">
        {/* Hour labels */}
        <div className="flex gap-[3px] mb-1.5 ml-9">
          {hours.map((hour) => (
            <div
              key={hour}
              className="w-5 h-5 flex items-center justify-center text-[12px] font-mono text-muted-foreground/60"
            >
              {hour % 4 === 0 ? hour.toString().padStart(2, "0") : ""}
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        {days.map((day, dayIndex) => (
          <div key={day} className="flex gap-[3px] mb-[3px]">
            <div className="w-9 flex items-center justify-end pr-2 text-[12px] font-medium text-muted-foreground/70 uppercase tracking-wider">
              {day}
            </div>
            {hours.map((hour) => {
              const activity = data.find((d) => d.hour === hour && d.day === dayIndex);
              const intensity = activity ? activity.activity_count / maxActivity : 0;
              const tokens = activity?.tokens_used || 0;
              const heatColor = getHeatColor(intensity);

              return (
                <Tooltip key={`${day}-${hour}`}>
                  <TooltipTrigger>
                    <div
                      className={cn(
                        "w-5 h-5 rounded-[3px] cursor-pointer",
                        "transition-all duration-200",
                        "hover:scale-[1.3] hover:z-10 relative",
                        intensity > 0 && "hover:ring-2 hover:ring-white/30",
                        intensity > 0.5 && "shadow-glow-green"
                      )}
                      style={{ backgroundColor: heatColor }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className={cn("font-mono", layout.smallText)}>
                    <div className="space-y-0.5">
                      <div className="font-semibold">
                        {day} {hour}:00
                      </div>
                      <div className="text-muted-foreground">
                        {activity?.activity_count || 0} activities
                      </div>
                      <div className="text-muted-foreground">{formatNumber(tokens)} tokens</div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-3 mt-4 ml-9">
          <span
            className={cn(
              "font-medium text-muted-foreground/60 uppercase tracking-wider",
              layout.smallText
            )}
          >
            {t("analytics.legend.less")}
          </span>
          <div className="flex gap-[2px]">
            <div
              className="w-4 h-4 rounded-[2px]"
              style={{ backgroundColor: "var(--heatmap-empty)" }}
            />
            <div
              className="w-4 h-4 rounded-[2px]"
              style={{ backgroundColor: "var(--heatmap-low)" }}
            />
            <div
              className="w-4 h-4 rounded-[2px]"
              style={{ backgroundColor: "var(--heatmap-medium)" }}
            />
            <div
              className="w-4 h-4 rounded-[2px]"
              style={{ backgroundColor: "var(--heatmap-high)" }}
            />
          </div>
          <span
            className={cn(
              "font-medium text-muted-foreground/60 uppercase tracking-wider",
              layout.smallText
            )}
          >
            {t("analytics.legend.more")}
          </span>
        </div>
      </div>
    </div>
  );
};

ActivityHeatmapComponent.displayName = "ActivityHeatmapComponent";
