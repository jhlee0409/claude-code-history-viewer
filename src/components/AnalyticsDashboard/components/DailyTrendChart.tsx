/**
 * DailyTrendChart Component
 *
 * Compact bar chart for 7-day activity.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import type { DailyStatData } from "../types";
import { formatNumber } from "../utils";

interface DailyTrendChartProps {
  dailyData: DailyStatData[];
}

const BAR_HEIGHT = 48; // px

export const DailyTrendChart: React.FC<DailyTrendChartProps> = ({ dailyData }) => {
  const { t } = useTranslation();

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  if (!dailyData.length) return null;

  const maxTokens = Math.max(...dailyData.map((d) => d.total_tokens), 1);
  const totalTokens = dailyData.reduce((sum, d) => sum + d.total_tokens, 0);
  const totalMessages = dailyData.reduce((sum, d) => sum + d.message_count, 0);
  const activeDays = dailyData.filter((d) => d.total_tokens > 0).length;

  const getDayName = (dateStr: string) => {
    const dayNames = t("analytics.weekdayNamesShort", { returnObjects: true }) as string[];
    const day = new Date(dateStr).getDay();
    return dayNames[day] || "";
  };

  return (
    <div className="space-y-3">
      {/* Bar Chart */}
      <div className="flex gap-2">
        {dailyData.map((stat) => {
          const isToday = stat.date === today;
          const ratio = stat.total_tokens / maxTokens;
          const barHeight = stat.total_tokens > 0 ? Math.max(ratio * BAR_HEIGHT, 4) : 2;
          const hasActivity = stat.total_tokens > 0;

          return (
            <Tooltip key={stat.date}>
              <TooltipTrigger asChild>
                <div className="flex-1 flex flex-col items-center cursor-pointer group">
                  {/* Bar container */}
                  <div
                    className="w-full flex items-end justify-center"
                    style={{ height: `${BAR_HEIGHT}px` }}
                  >
                    <div
                      className="w-full rounded-t-sm transition-all duration-200 group-hover:brightness-110"
                      style={{
                        height: `${barHeight}px`,
                        backgroundColor: isToday
                          ? "#22c55e"
                          : hasActivity
                            ? "rgba(34, 197, 94, 0.5)"
                            : "rgba(128, 128, 128, 0.15)",
                      }}
                    />
                  </div>
                  {/* Day label */}
                  <span
                    className="text-[9px] font-mono tabular-nums mt-1"
                    style={{
                      fontWeight: isToday ? 600 : 400,
                      color: isToday ? "#22c55e" : "var(--muted-foreground)",
                      opacity: isToday ? 1 : 0.5,
                    }}
                  >
                    {stat.date?.slice(8)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-xs">
                <div className="space-y-1">
                  <div className="font-semibold flex items-center gap-2">
                    <span>{stat.date}</span>
                    <span className="text-muted-foreground font-normal">({getDayName(stat.date)})</span>
                  </div>
                  <div className="text-[10px] grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <span className="text-muted-foreground">Tokens</span>
                    <span className="text-right" style={{ color: "#22c55e" }}>{formatNumber(stat.total_tokens)}</span>
                    <span className="text-muted-foreground">Messages</span>
                    <span className="text-right">{stat.message_count}</span>
                    <span className="text-muted-foreground">Sessions</span>
                    <span className="text-right">{stat.session_count}</span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Summary row */}
      <div className="flex items-center justify-between text-[10px] pt-2 border-t border-border/20">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-muted-foreground">{t("analytics.dailyAvgTokens")}: </span>
            <span className="font-mono font-semibold text-foreground">{formatNumber(Math.round(totalTokens / 7))}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("analytics.dailyAvgMessages")}: </span>
            <span className="font-mono font-semibold text-foreground">{Math.round(totalMessages / 7)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground/60">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
          <span>{activeDays}/7 {t("analytics.weeklyActiveDays")}</span>
        </div>
      </div>
    </div>
  );
};

DailyTrendChart.displayName = "DailyTrendChart";
