/**
 * DailyTrendChart Component
 *
 * Displays 7-day activity trend with bar chart.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "@/lib/utils";
import type { DailyStatData } from "../types";
import { formatNumber } from "../utils";

interface DailyTrendChartProps {
  dailyData: DailyStatData[];
}

export const DailyTrendChart: React.FC<DailyTrendChartProps> = ({ dailyData }) => {
  const { t } = useTranslation("components");

  if (!dailyData.length) return null;

  const maxTokens = Math.max(...dailyData.map((d) => d.total_tokens), 1);
  const totalTokens = dailyData.reduce((sum, d) => sum + d.total_tokens, 0);
  const totalMessages = dailyData.reduce((sum, d) => sum + d.message_count, 0);
  const activeDays = dailyData.filter((d) => d.total_tokens > 0).length;

  return (
    <div className="space-y-5">
      {/* Chart */}
      <div className="relative h-44">
        {/* Grid lines */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-border/30" />
          ))}
        </div>

        {/* Bars */}
        <div className="absolute inset-0 flex items-end justify-between gap-2 pb-6">
          {dailyData.map((stat) => {
            const height = Math.max(4, (stat.total_tokens / maxTokens) * 100);
            const isToday = stat.date === new Date().toISOString().split("T")[0];
            const dateObj = stat.date ? new Date(stat.date) : new Date();
            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

            // Gradient colors using CSS variables
            const barGradient = isToday
              ? "linear-gradient(to top, var(--chart-green-from), var(--chart-green-to))"
              : isWeekend
              ? "linear-gradient(to top, var(--chart-blue-from), var(--chart-blue-to))"
              : stat.total_tokens > maxTokens * 0.7
              ? "linear-gradient(to top, var(--chart-purple-from), var(--chart-purple-to))"
              : "linear-gradient(to top, var(--chart-muted-from), var(--chart-muted-to))";

            const glowColor = isToday
              ? "var(--chart-glow-green)"
              : isWeekend
              ? "var(--chart-glow-blue)"
              : "transparent";

            return (
              <Tooltip key={stat.date}>
                <TooltipTrigger asChild>
                  <div className="flex-1 flex flex-col items-center justify-end h-full group cursor-pointer">
                    <div
                      className={cn(
                        "w-full rounded-t-md transition-all duration-300",
                        "group-hover:brightness-125 group-hover:scale-[1.02]"
                      )}
                      style={{
                        height: `${height}%`,
                        minHeight: "4px",
                        background: barGradient,
                        boxShadow: `0 0 16px ${glowColor}`,
                      }}
                    >
                      {/* Value label on bar */}
                      {stat.total_tokens > 0 && height > 20 && (
                        <div className="flex items-center justify-center h-full">
                          <span className="font-mono text-[12px] font-semibold text-white/90 drop-shadow-sm">
                            {formatNumber(stat.total_tokens)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Date label */}
                    <div
                      className={cn(
                        "mt-2 text-[12px] font-mono",
                        isToday ? "font-bold text-success" : "text-muted-foreground/60"
                      )}
                    >
                      {stat.date?.slice(5).replace("-", "/")}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-xs space-y-1">
                  <div className="font-semibold">{stat.date}</div>
                  <div>Tokens: {formatNumber(stat.total_tokens)}</div>
                  <div>Messages: {stat.message_count}</div>
                  <div>Sessions: {stat.session_count}</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border/50">
        <div className="text-center">
          <div className="font-mono text-lg font-bold text-foreground">
            {formatNumber(Math.round(totalTokens / 7))}
          </div>
          <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("analytics.dailyAvgTokens")}
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-lg font-bold text-foreground">
            {Math.round(totalMessages / 7)}
          </div>
          <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("analytics.dailyAvgMessages")}
          </div>
        </div>
        <div className="text-center">
          <div className="font-mono text-lg font-bold text-foreground">
            {activeDays}
            <span className="text-muted-foreground/60">/7</span>
          </div>
          <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("analytics.weeklyActiveDays")}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 text-[12px]">
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{
              background: "linear-gradient(to top, var(--chart-green-from), var(--chart-green-to))",
            }}
          />
          <span className="text-muted-foreground">{t("analytics.today")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{
              background:
                "linear-gradient(to top, var(--chart-purple-from), var(--chart-purple-to))",
            }}
          />
          <span className="text-muted-foreground">{t("analytics.highActivity")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded"
            style={{
              background: "linear-gradient(to top, var(--chart-blue-from), var(--chart-blue-to))",
            }}
          />
          <span className="text-muted-foreground">{t("analytics.weekend")}</span>
        </div>
      </div>
    </div>
  );
};

DailyTrendChart.displayName = "DailyTrendChart";
