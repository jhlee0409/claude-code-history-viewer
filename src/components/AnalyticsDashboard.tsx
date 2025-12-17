"use client";

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  TrendingUp,
  Clock,
  MessageCircle,
  Activity,
  Wrench,
  Zap,
  Database,
  Eye,
  Hash,
  Target,
  Users,
  Award,
  Timer,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { ToolUsageStats, ActivityHeatmap } from "../types";
import { formatTime, formatDuration } from "../utils/time";
import { COLORS } from "../constants/colors";
import { cn } from "../utils/cn";
import { useAppStore } from "../store/useAppStore";
import { useAnalytics } from "../hooks/useAnalytics";

/**
 * Analytics Dashboard Component
 *
 * props 전달을 최소화하고 직접 store와 hook을 사용하여 의존성을 낮춤
 */
interface AnalyticsDashboardProps {
  isViewingGlobalStats?: boolean;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ isViewingGlobalStats = false }) => {
  const { selectedProject, selectedSession, sessionTokenStats, globalSummary, isLoadingGlobalStats } = useAppStore();

  const { state: analyticsState } = useAnalytics();
  const { t } = useTranslation("components");
  const [activeTab, setActiveTab] = useState<"project" | "session">("project");

  // 컴포넌트 내부에서 사용할 데이터 정의
  const projectSummary = analyticsState.projectSummary;
  const sessionComparison = analyticsState.sessionComparison;
  const sessionStats = sessionTokenStats;

  // Calculate growth rates
  const calculateGrowthRate = (current: number, previous: number): number => {
    if (previous === 0) return 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  // Format large numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Calculate Claude API pricing based on model and token counts
  const calculateModelPrice = (
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number
  ): number => {
    // Pricing per million tokens (MTok)
    const pricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
      'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
      'claude-opus-4-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
      'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
      'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
      'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
      'claude-3-5-haiku': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
      'claude-3-haiku': { input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
    };

    // Find matching pricing tier (partial match for versioned models)
    let modelPricing: { input: number; output: number; cacheWrite: number; cacheRead: number } = pricing['claude-sonnet-4-5']; // default to sonnet
    for (const [key, value] of Object.entries(pricing)) {
      if (modelName.toLowerCase().includes(key)) {
        modelPricing = value;
        break;
      }
    }

    // Calculate cost: (tokens / 1,000,000) * price_per_MTok
    const inputCost = (inputTokens / 1000000) * modelPricing.input;
    const outputCost = (outputTokens / 1000000) * modelPricing.output;
    const cacheWriteCost = (cacheCreationTokens / 1000000) * modelPricing.cacheWrite;
    const cacheReadCost = (cacheReadTokens / 1000000) * modelPricing.cacheRead;

    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  };

  // 7일간의 일별 데이터 생성 (누락된 날짜 채우기)
  const generateDailyData = () => {
    if (!projectSummary?.daily_stats) return [];

    // 최근 7일 날짜 배열 생성
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return date.toISOString().split("T")[0];
    });

    // 날짜별 데이터 집계
    const dailyData = last7Days.map((date) => {
      const dayStats = projectSummary.daily_stats.find(
        (stat) => stat.date === date
      );

      return {
        date,
        total_tokens: dayStats?.total_tokens || 0,
        message_count: dayStats?.message_count || 0,
        session_count: dayStats?.session_count || 0,
        active_hours: dayStats?.active_hours || 0,
      };
    });

    return dailyData;
  };

  // Activity heatmap component
  const ActivityHeatmapComponent = ({ data }: { data: ActivityHeatmap[] }) => {
    const maxActivity = Math.max(...data.map((d) => d.activity_count), 1);
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const days = t("analytics.weekdayNames", { returnObjects: true });
    return (
      <div className="overflow-x-auto h-[calc(100%-30px)]">
        <div className="inline-block min-w-max">
          {/* Hour labels */}
          <div className="flex gap-1 mb-1 ml-10">
            {hours.map((hour) => (
              <div
                key={hour}
                className={cn(
                  "w-6 h-6 flex items-center justify-center text-xs",
                  COLORS.ui.text.muted
                )}
              >
                {hour % 3 === 0 ? hour : ""}
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          {days.map((day, dayIndex) => (
            <div key={day} className="flex gap-1 mb-1">
              <div
                className={cn(
                  "w-6 flex items-center justify-end pr-2 text-xs",
                  COLORS.ui.text.muted
                )}
              >
                {day}
              </div>
              {hours.map((hour) => {
                const activity = data.find(
                  (d) => d.hour === hour && d.day === dayIndex
                );
                const intensity = activity
                  ? activity.activity_count / maxActivity
                  : 0;
                const tokens = activity?.tokens_used || 0;

                return (
                  <Tooltip key={`${day}-${hour}`}>
                    <TooltipTrigger>
                      <div
                        className={cn(
                          "w-6 h-6 rounded-sm transition-all hover:scale-125 hover:ring-2 hover:ring-white/50 cursor-pointer",
                          intensity > 0.8
                            ? "bg-emerald-500"
                            : intensity > 0.6
                            ? "bg-emerald-600"
                            : intensity > 0.4
                            ? "bg-emerald-700"
                            : intensity > 0.2
                            ? "bg-emerald-800"
                            : intensity > 0
                            ? "bg-emerald-900"
                            : "bg-gray-800 dark:bg-gray-900"
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="whitespace-pre-wrap">
                        {t("analytics.heatmapTooltip", {
                          day,
                          hour,
                          activity: activity?.activity_count || 0,
                          tokens: formatNumber(tokens),
                        })}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 ml-10">
            <span className={cn("text-xs", COLORS.ui.text.muted)}>
              {t("analytics.legend.less")}
            </span>
            <div className="flex gap-1">
              <div className="w-4 h-4 bg-gray-800 dark:bg-gray-900 rounded-sm" />
              <div className="w-4 h-4 bg-emerald-900 rounded-sm" />
              <div className="w-4 h-4 bg-emerald-700 rounded-sm" />
              <div className="w-4 h-4 bg-emerald-600 rounded-sm" />
              <div className="w-4 h-4 bg-emerald-500 rounded-sm" />
            </div>
            <span className={cn("text-xs", COLORS.ui.text.muted)}>
              {t("analytics.legend.more")}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Tool name mapping for better display
  const getToolDisplayName = (toolName: string): string => {
    const toolMap: Record<string, string> = {
      Bash: t("tools.terminal"),
      Read: t("tools.readFile"),
      Edit: t("tools.editFile"),
      Write: t("tools.createFile"),
      MultiEdit: t("tools.multiEdit"),
      Glob: t("tools.findFiles"),
      Grep: t("tools.searchText"),
      LS: t("tools.browseDirectory"),
      Task: t("tools.executeTask"),
      WebFetch: t("tools.webFetch"),
      WebSearch: t("tools.webSearch"),
      NotebookRead: t("tools.notebookRead"),
      NotebookEdit: t("tools.notebookEdit"),
      TodoRead: t("tools.todoRead"),
      TodoWrite: t("tools.todoWrite"),
      exit_plan_mode: t("tools.exitPlanMode"),
    };

    return toolMap[toolName] || `🔧 ${toolName}`;
  };

  // Tool usage chart
  const ToolUsageChart = ({ tools }: { tools: ToolUsageStats[] }) => {
    const topTools = tools.slice(0, 6);
    const maxUsage = Math.max(...topTools.map((t) => t.usage_count), 1);

    if (topTools.length === 0) {
      return (
        <div className={cn("text-center py-8", COLORS.ui.text.muted)}>
          <Wrench
            className={cn("w-12 h-12 mx-auto mb-2", COLORS.ui.text.disabled)}
          />
          <p>{t("analytics.noData")}</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {topTools.map((tool, index) => {
          const colors = [
            {
              bg: "bg-blue-500",
              border: "border-blue-200",
              text: "text-blue-700",
            },
            {
              bg: "bg-green-500",
              border: "border-green-200",
              text: "text-green-700",
            },
            {
              bg: "bg-purple-500",
              border: "border-purple-200",
              text: "text-purple-700",
            },
            {
              bg: "bg-orange-500",
              border: "border-orange-200",
              text: "text-orange-700",
            },
            {
              bg: "bg-pink-500",
              border: "border-pink-200",
              text: "text-pink-700",
            },
            {
              bg: "bg-indigo-500",
              border: "border-indigo-200",
              text: "text-indigo-700",
            },
          ];
          const color = colors[index] || colors[colors.length - 1];

          return (
            <div key={tool.tool_name} className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <div className={cn("w-3 h-3 rounded-full", color?.bg)} />
                  <span
                    className={cn(
                      "text-sm font-medium",
                      COLORS.ui.text.secondary
                    )}
                  >
                    {getToolDisplayName(tool.tool_name)}
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className={cn("text-sm font-bold", COLORS.ui.text.primary)}
                  >
                    {t("analytics.count", { count: tool.usage_count })}
                  </span>
                  {Math.round(tool.success_rate) !== 100 && (
                    <div className={cn("text-xs", COLORS.ui.text.muted)}>
                      {t("analytics.successRate", {
                        percent: Math.round(tool.success_rate),
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="relative">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                  <div
                    className={cn(
                      "h-3 rounded-full transition-all duration-500",
                      color?.bg
                    )}
                    style={{ width: `${(tool.usage_count / maxUsage) * 100}%` }}
                  />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-medium text-white mix-blend-difference">
                    {(
                      (tool.usage_count /
                        topTools.reduce((sum, t) => sum + t.usage_count, 0)) *
                      100
                    ).toFixed(1)}
                    %
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Project Statistics View
  const ProjectStatsView = () => {
    if (!projectSummary) return null;

    const lastDayStats =
      projectSummary.daily_stats[projectSummary.daily_stats.length - 1];
    const prevDayStats =
      projectSummary.daily_stats[projectSummary.daily_stats.length - 2];

    const tokenGrowth =
      lastDayStats && prevDayStats
        ? calculateGrowthRate(
            lastDayStats.total_tokens,
            prevDayStats.total_tokens
          )
        : 0;

    return (
      <div className="space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950",
              COLORS.semantic.info.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <MessageCircle
                className={cn("w-8 h-8", COLORS.semantic.info.icon)}
              />
              <span
                className={cn(
                  "text-xs px-2 py-1 rounded",
                  tokenGrowth > 0
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : tokenGrowth < 0
                    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                )}
              >
                {tokenGrowth > 0 ? "+" : ""}
                {tokenGrowth}%
              </span>
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {formatNumber(projectSummary.total_messages)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.totalMessages")}
            </div>
          </div>

          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950",
              COLORS.tools.search.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Activity className={cn("w-8 h-8", COLORS.tools.search.icon)} />
              <span className={cn("text-xs", COLORS.ui.text.muted)}>
                {projectSummary.total_sessions} sessions
              </span>
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {formatNumber(projectSummary.total_tokens)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.totalTokens")}
            </div>
          </div>

          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950",
              COLORS.semantic.success.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Clock className={cn("w-8 h-8", COLORS.semantic.success.icon)} />
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {formatDuration(projectSummary.avg_session_duration)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.avgSessionTime")}
            </div>
          </div>

          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950",
              COLORS.semantic.warning.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Wrench className={cn("w-8 h-8", COLORS.semantic.warning.icon)} />
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {projectSummary.most_used_tools.length}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.toolsUsed")}
            </div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity Heatmap */}
          <div
            className={cn(
              "p-6 rounded-lg border",
              COLORS.ui.background.white,
              COLORS.ui.border.medium
            )}
          >
            <h3
              className={cn(
                "text-lg font-semibold mb-4",
                COLORS.ui.text.primary
              )}
            >
              {t("analytics.activityHeatmapTitle")}
            </h3>
            {projectSummary.activity_heatmap.length > 0 ? (
              <ActivityHeatmapComponent
                data={projectSummary.activity_heatmap}
              />
            ) : (
              <div className={cn("text-center py-8", COLORS.ui.text.muted)}>
                {t("analytics.No activity data available")}
              </div>
            )}
          </div>

          {/* Tool Usage */}
          <div
            className={cn(
              "p-6 rounded-lg border",
              COLORS.ui.background.white,
              COLORS.ui.border.medium
            )}
          >
            <h3
              className={cn(
                "text-lg font-semibold mb-4",
                COLORS.ui.text.primary
              )}
            >
              {t("analytics.mostUsedToolsTitle")}
            </h3>
            {projectSummary.most_used_tools.length > 0 ? (
              <ToolUsageChart tools={projectSummary.most_used_tools} />
            ) : (
              <div className={cn("text-center py-8", COLORS.ui.text.muted)}>
                {t("analytics.No tool usage data available")}
              </div>
            )}
          </div>
        </div>

        {/* Daily Trend Chart */}
        {projectSummary.daily_stats.length > 0 && (
          <div
            className={cn(
              "p-6 rounded-lg border",
              COLORS.ui.background.white,
              COLORS.ui.border.medium
            )}
          >
            <h3
              className={cn(
                "text-lg font-semibold mb-4 flex items-center space-x-2",
                COLORS.ui.text.primary
              )}
            >
              <TrendingUp className="w-4 h-4" />
              <span>{t("analytics.recentActivityTrend")}</span>
            </h3>
            <div className="space-y-4">
              {/* Enhanced bar chart */}
              <div className="relative h-48">
                <div className="absolute  inset-0 flex items-end justify-between gap-1">
                  {generateDailyData().map((stat) => {
                    const dailyData = generateDailyData();
                    const maxTokens = Math.max(
                      ...dailyData.map((s) => s.total_tokens),
                      1
                    );
                    const height = Math.max(
                      0,
                      (stat.total_tokens / maxTokens) * 100
                    );

                    const isWeekend =
                      new Date(stat.date || "").getDay() === 0 ||
                      new Date(stat.date || "").getDay() === 6;
                    const isToday =
                      stat.date === new Date().toISOString().split("T")[0];

                    return (
                      <Tooltip key={stat.date}>
                        <TooltipTrigger asChild>
                          <div className="flex-1 flex flex-col items-center justify-end group relative h-full">
                            <div
                              className={cn(
                                "w-full rounded-t transition-all duration-300 cursor-pointer",
                                "hover:scale-105 hover:shadow-lg ",
                                isToday
                                  ? "bg-linear-to-t from-emerald-600 to-emerald-400"
                                  : isWeekend
                                  ? "bg-linear-to-t from-purple-600 to-purple-400"
                                  : stat.total_tokens > maxTokens * 0.7
                                  ? "bg-linear-to-t from-blue-600 to-blue-400"
                                  : stat.total_tokens > maxTokens * 0.3
                                  ? "bg-linear-to-t from-indigo-600 to-indigo-400"
                                  : "bg-linear-to-t from-gray-500 to-gray-400"
                              )}
                              style={{ height: `${height}%`, minHeight: "4px" }}
                            >
                              {/* 사용 토큰수 */}
                              {stat.total_tokens > 0 && (
                                <div className="text-xs text-center absolute left-0 mb-4 right-0  flex items-center justify-center text-white">
                                  {formatNumber(stat.total_tokens)}
                                </div>
                              )}
                            </div>

                            {/* Date labels for all days */}
                            <div
                              className={cn(
                                "text-xs text-center absolute -bottom-4 left-0 right-0",
                                isToday
                                  ? "font-bold text-emerald-600"
                                  : "text-gray-500"
                              )}
                            >
                              {stat.date?.slice(5)}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{stat.date}</p>
                          <p>
                            📊 {t("analytics.tooltipTokens")}{" "}
                            {formatNumber(stat.total_tokens)}
                          </p>
                          <p>
                            💬 {t("analytics.tooltipMessages")}{" "}
                            {stat.message_count}
                          </p>
                          <p>
                            🎯 {t("analytics.tooltipSessions")}{" "}
                            {stat.session_count}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              {/* Stats summary */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="text-center">
                  <div
                    className={cn("text-lg font-bold", COLORS.ui.text.primary)}
                  >
                    {generateDailyData().reduce(
                      (sum, s) => sum + s.total_tokens,
                      0
                    ) > 0
                      ? formatNumber(
                          Math.round(
                            generateDailyData().reduce(
                              (sum, s) => sum + s.total_tokens,
                              0
                            ) / 7
                          )
                        )
                      : "0"}
                  </div>
                  <div className={cn("text-xs", COLORS.ui.text.muted)}>
                    {t("analytics.dailyAvgTokens")}
                  </div>
                </div>
                <div className="text-center">
                  <div
                    className={cn("text-lg font-bold", COLORS.ui.text.primary)}
                  >
                    {Math.round(
                      generateDailyData().reduce(
                        (sum, s) => sum + s.message_count,
                        0
                      ) / 7
                    )}
                  </div>
                  <div className={cn("text-xs", COLORS.ui.text.muted)}>
                    {t("analytics.dailyAvgMessages")}
                  </div>
                </div>
                <div className="text-center">
                  <div
                    className={cn("text-lg font-bold", COLORS.ui.text.primary)}
                  >
                    {
                      generateDailyData().filter((s) => s.total_tokens > 0)
                        .length
                    }
                  </div>
                  <div className={cn("text-xs", COLORS.ui.text.muted)}>
                    {t("analytics.weeklyActiveDays")}
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center space-x-4 text-xs">
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-linear-to-t from-emerald-600 to-emerald-400 rounded" />
                  <span className={cn(COLORS.ui.text.muted)}>
                    {t("analytics.today")}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-linear-to-t from-blue-600 to-blue-400 rounded" />
                  <span className={cn(COLORS.ui.text.muted)}>
                    {t("analytics.highActivity")}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-linear-to-t from-purple-600 to-purple-400 rounded" />
                  <span className={cn(COLORS.ui.text.muted)}>
                    {t("analytics.weekend")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Token Distribution */}
        <div
          className={cn(
            "p-6 rounded-lg border",
            COLORS.ui.background.white,
            COLORS.ui.border.medium
          )}
        >
          <h3
            className={cn("text-lg font-semibold mb-4", COLORS.ui.text.primary)}
          >
            {t("analytics.tokenTypeDistribution")}
          </h3>
          <div className="space-y-4">
            {/* Token type bars */}
            <div className="space-y-3">
              {[
                {
                  label: "Input",
                  value: projectSummary.token_distribution.input,
                  color: COLORS.semantic.success.textDark,
                  bgColor: "bg-green-800 dark:bg-green-300",
                },
                {
                  label: "Output",
                  value: projectSummary.token_distribution.output,
                  color: COLORS.semantic.info.textDark,
                  bgColor: "bg-blue-800 dark:bg-blue-300",
                },
                {
                  label: "Cache Creation",
                  value: projectSummary.token_distribution.cache_creation,
                  color: COLORS.tools.search.text,
                  bgColor: "bg-purple-800 dark:bg-purple-300",
                },
                {
                  label: "Cache Read",
                  value: projectSummary.token_distribution.cache_read,
                  color: COLORS.tools.task.text,
                  bgColor: "bg-orange-800 dark:bg-orange-300",
                },
              ].map((item) => {
                const percentage =
                  (item.value / projectSummary.total_tokens) * 100;

                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className={cn("text-sm", COLORS.ui.text.secondary)}>
                        {item.label}
                      </span>
                      <span className={cn("text-sm font-medium", item.color)}>
                        {formatNumber(item.value)} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={cn(
                          "h-2 rounded-full transition-all",
                          item.bgColor
                        )}
                        style={{
                          width: `${percentage}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div
              className={cn(
                "pt-3 border-t text-center",
                COLORS.ui.border.light
              )}
            >
              <div className={cn("text-3xl font-bold", COLORS.ui.text.primary)}>
                {formatNumber(projectSummary.total_tokens)}
              </div>
              <div className={cn("text-sm", COLORS.ui.text.muted)}>
                {t("analytics.totalTokenUsage")}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Session Statistics View
  const SessionStatsView = () => {
    if (!sessionStats || !sessionComparison) return null;

    const avgTokensPerMessage =
      sessionStats.message_count > 0
        ? Math.round(sessionStats.total_tokens / sessionStats.message_count)
        : 0;

    const sessionDuration =
      new Date(sessionStats.last_message_time).getTime() -
      new Date(sessionStats.first_message_time).getTime();
    const durationMinutes = Math.round(sessionDuration / (1000 * 60));

    return (
      <div className="space-y-6">
        {/* Performance Insights */}
        <div
          className={cn(
            "p-6 rounded-lg border",
            sessionComparison.is_above_average
              ? "bg-linear-to-r from-emerald-50 to-green-50 dark:from-emerald-950 dark:to-green-950"
              : "bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950",
            sessionComparison.is_above_average
              ? COLORS.semantic.success.border
              : COLORS.semantic.warning.border
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={cn("text-lg font-semibold", COLORS.ui.text.primary)}>
              {t("analytics.performanceInsights")}
            </h3>
            <div
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium",
                sessionComparison.is_above_average
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              )}
            >
              {sessionComparison.is_above_average
                ? t("analytics.aboveAverage")
                : t("analytics.belowAverage")}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center">
              <div
                className={cn(
                  "text-3xl font-bold mb-1",
                  COLORS.ui.text.primary
                )}
              >
                #{sessionComparison.rank_by_tokens}
              </div>
              <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
                {t("analytics.tokenRank")}
              </div>
              <div className={cn("text-xs mt-1", COLORS.ui.text.muted)}>
                {t("analytics.topPercent", {
                  percent: (
                    (sessionComparison.rank_by_tokens /
                      (projectSummary?.total_sessions || 1)) *
                    100
                  ).toFixed(0),
                })}
              </div>
            </div>

            <div className="text-center">
              <div
                className={cn(
                  "text-3xl font-bold mb-1",
                  COLORS.ui.text.primary
                )}
              >
                {sessionComparison.percentage_of_project_tokens.toFixed(1)}%
              </div>
              <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
                {t("analytics.projectShare")}
              </div>
              <div className={cn("text-xs mt-1", COLORS.ui.text.muted)}>
                {t("analytics.totalLabel")}{" "}
                {formatNumber(sessionStats.total_tokens)}{" "}
                {t("analytics.tokens")}
              </div>
            </div>

            <div className="text-center">
              <div
                className={cn(
                  "text-3xl font-bold mb-1",
                  COLORS.ui.text.primary
                )}
              >
                {avgTokensPerMessage.toLocaleString()}
              </div>
              <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
                {t("analytics.tokensPerMessage")}
              </div>
              <div className={cn("text-xs mt-1", COLORS.ui.text.muted)}>
                {t("analytics.totalMessagesCount", {
                  count: sessionStats.message_count,
                })}
              </div>
            </div>

            <div className="text-center">
              <div
                className={cn(
                  "text-3xl font-bold mb-1",
                  COLORS.ui.text.primary
                )}
              >
                {t("analytics.durationMinutes", { minutes: durationMinutes })}
              </div>
              <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
                {t("analytics.sessionTime")}
              </div>
              <div className={cn("text-xs mt-1", COLORS.ui.text.muted)}>
                {t("analytics.rank", {
                  rank: sessionComparison.rank_by_duration,
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Token Breakdown */}
        <div
          className={cn(
            "p-6 rounded-lg border",
            COLORS.ui.background.white,
            COLORS.ui.border.medium
          )}
        >
          <h3
            className={cn("text-lg font-semibold mb-4", COLORS.ui.text.primary)}
          >
            {t("analytics.tokenAnalysis")}
          </h3>

          <div className="space-y-4">
            {[
              {
                label: "Input",
                value: sessionStats.total_input_tokens,
                icon: TrendingUp,
                color: COLORS.semantic.success.textDark,
                bgColor: "bg-green-500",
              },
              {
                label: "Output",
                value: sessionStats.total_output_tokens,
                icon: Zap,
                color: COLORS.semantic.info.textDark,
                bgColor: "bg-blue-500",
              },
              {
                label: "Cache Creation",
                value: sessionStats.total_cache_creation_tokens,
                icon: Database,
                color: COLORS.tools.search.text,
                bgColor: "bg-purple-500",
              },
              {
                label: "Cache Read",
                value: sessionStats.total_cache_read_tokens,
                icon: Eye,
                color: COLORS.tools.task.text,
                bgColor: "bg-orange-500",
              },
            ].map((item) => {
              const percentage = (item.value / sessionStats.total_tokens) * 100;
              const Icon = item.icon;

              return (
                <div key={item.label} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <Icon className={cn("w-4 h-4", item.color)} />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          COLORS.ui.text.secondary
                        )}
                      >
                        {item.label}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={cn("text-sm font-bold", item.color)}>
                        {formatNumber(item.value)}
                      </span>
                      <span
                        className={cn("text-xs ml-2", COLORS.ui.text.muted)}
                      >
                        ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={cn(
                        "h-2 rounded-full transition-all",
                        item.bgColor
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className={cn(
              "mt-6 pt-4 border-t text-center",
              COLORS.ui.border.light
            )}
          >
            <div
              className={cn("text-2xl font-bold mb-1", COLORS.ui.text.primary)}
            >
              {formatNumber(sessionStats.total_tokens)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.muted)}>
              {t("analytics.totalTokenUsageLabel")}
            </div>
          </div>
        </div>

        {/* Session Timeline */}
        <div
          className={cn(
            "p-6 rounded-lg border",
            COLORS.ui.background.white,
            COLORS.ui.border.medium
          )}
        >
          <h3
            className={cn("text-lg font-semibold mb-4", COLORS.ui.text.primary)}
          >
            {t("analytics.sessionTimeline")}
          </h3>

          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div>
                <div
                  className={cn(
                    "text-sm font-medium",
                    COLORS.ui.text.secondary
                  )}
                >
                  {t("analytics.startTime")}
                </div>
                <div className={cn("text-xs", COLORS.ui.text.muted)}>
                  {formatTime(sessionStats.first_message_time)}
                </div>
              </div>
              <div className="text-center">
                <div
                  className={cn(
                    "text-sm font-medium",
                    COLORS.ui.text.secondary
                  )}
                >
                  {t("analytics.duration")}
                </div>
                <div className={cn("text-xs", COLORS.ui.text.muted)}>
                  {durationMinutes}
                  {t("analytics.minutesUnit")}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={cn(
                    "text-sm font-medium",
                    COLORS.ui.text.secondary
                  )}
                >
                  {t("analytics.endTime")}
                </div>
                <div className={cn("text-xs", COLORS.ui.text.muted)}>
                  {formatTime(sessionStats.last_message_time)}
                </div>
              </div>
            </div>

            <div className="text-center">
              <code
                className={cn(
                  "inline-block px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono",
                  COLORS.ui.text.tertiary
                )}
              >
                {t("analytics.sessionIdLabel")}{" "}
                {sessionStats.session_id.substring(0, 16)}...
              </code>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Quick Stats Bar Component
  const QuickStatsBar = () => {
    if (!projectSummary) return null;

    const sessionRank = sessionComparison?.rank_by_tokens || null;
    const sessionPercentage =
      sessionComparison?.percentage_of_project_tokens || 0;

    return (
      <div
        className={cn(
          "p-4 rounded-lg border mb-6",
          "bg-linear-to-r from-indigo-50 via-purple-50 to-pink-50",
          "dark:from-indigo-950 dark:via-purple-950 dark:to-pink-950",
          COLORS.semantic.info.border
        )}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Target
                className={cn("w-4 h-4 mr-1", COLORS.semantic.info.icon)}
              />
              <span
                className={cn("text-xs font-medium", COLORS.ui.text.tertiary)}
              >
                {t("analytics.totalTokens")}
              </span>
            </div>
            <div className={cn("text-xl font-bold", COLORS.ui.text.primary)}>
              {formatNumber(projectSummary.total_tokens)}
            </div>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Users
                className={cn("w-4 h-4 mr-1", COLORS.semantic.success.icon)}
              />
              <span
                className={cn("text-xs font-medium", COLORS.ui.text.tertiary)}
              >
                {t("analytics.totalSessions")}
              </span>
            </div>
            <div className={cn("text-xl font-bold", COLORS.ui.text.primary)}>
              {projectSummary.total_sessions}
              {t("analytics.sessionsUnit")}
            </div>
          </div>

          {selectedSession && sessionStats && (
            <>
              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Award
                    className={cn("w-4 h-4 mr-1", COLORS.semantic.warning.icon)}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      COLORS.ui.text.tertiary
                    )}
                  >
                    {t("analytics.sessionRank")}
                  </span>
                </div>
                <div
                  className={cn("text-xl font-bold", COLORS.ui.text.primary)}
                >
                  #{sessionRank || "-"}
                </div>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Timer
                    className={cn("w-4 h-4 mr-1", COLORS.tools.search.icon)}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      COLORS.ui.text.tertiary
                    )}
                  >
                    {t("analytics.projectShare")}
                  </span>
                </div>
                <div
                  className={cn("text-xl font-bold", COLORS.ui.text.primary)}
                >
                  {sessionPercentage.toFixed(1)}%
                </div>
              </div>
            </>
          )}

          {!selectedSession && (
            <>
              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Clock
                    className={cn("w-4 h-4 mr-1", COLORS.semantic.warning.icon)}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      COLORS.ui.text.tertiary
                    )}
                  >
                    {t("analytics.avgSession")}
                  </span>
                </div>
                <div
                  className={cn("text-xl font-bold", COLORS.ui.text.primary)}
                >
                  {formatDuration(projectSummary.avg_session_duration)}
                </div>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Activity
                    className={cn("w-4 h-4 mr-1", COLORS.tools.search.icon)}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      COLORS.ui.text.tertiary
                    )}
                  >
                    {t("analytics.activeTime")}
                  </span>
                </div>
                <div
                  className={cn("text-xl font-bold", COLORS.ui.text.primary)}
                >
                  {projectSummary.most_active_hour}
                  {t("analytics.hourSuffix")}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // Tab Navigation Component
  const TabNavigation = () => {
    const hasSessionData = selectedSession && sessionStats && sessionComparison;

    return (
      <div className="flex mb-6">
        <div
          className={cn("flex rounded-lg p-1", "bg-gray-100 dark:bg-gray-800")}
        >
          <button
            onClick={() => setActiveTab("project")}
            className={cn(
              "px-4 py-2 rounded-md font-medium transition-all",
              "flex items-center space-x-2",
              activeTab === "project"
                ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            )}
          >
            <BarChart3 className="w-4 h-4" />
            <span>{t("analytics.projectOverview")}</span>
          </button>

          {hasSessionData && (
            <button
              onClick={() => setActiveTab("session")}
              className={cn(
                "px-4 py-2 rounded-md font-medium transition-all",
                "flex items-center space-x-2",
                activeTab === "session"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              )}
            >
              <Target className="w-4 h-4" />
              <span>{t("analytics.sessionDetails")}</span>
            </button>
          )}
        </div>

        {hasSessionData && (
          <div className="ml-auto flex items-center space-x-2 text-sm text-gray-500">
            <Hash className="w-4 h-4" />
            <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
              {selectedSession.session_id.substring(0, 8)}...
            </code>
          </div>
        )}
      </div>
    );
  };

  // Global Stats View Component - matches ProjectStatsView layout
  const GlobalStatsView = () => {
    if (!globalSummary) return null;

    // Use the actual calculated session duration from backend (in minutes)
    const totalSessionTime = globalSummary.total_session_duration_minutes;

    return (
      <div className="space-y-6">
        {/* Overview Cards - Total Tokens first, then Total Messages */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950",
              COLORS.tools.search.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Activity className={cn("w-8 h-8", COLORS.tools.search.icon)} />
              <span className={cn("text-xs", COLORS.ui.text.muted)}>
                {globalSummary.total_projects} {t("analytics.totalProjects")}
              </span>
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {formatNumber(globalSummary.total_tokens)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.totalTokens")}
            </div>
          </div>

          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950",
              COLORS.semantic.info.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <MessageCircle
                className={cn("w-8 h-8", COLORS.semantic.info.icon)}
              />
              <span className={cn("text-xs", COLORS.ui.text.muted)}>
                {t("analytics.totalSessions")}: {globalSummary.total_sessions}
              </span>
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {formatNumber(globalSummary.total_messages)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.totalMessages")}
            </div>
          </div>

          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950",
              COLORS.semantic.success.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Clock className={cn("w-8 h-8", COLORS.semantic.success.icon)} />
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {formatDuration(totalSessionTime)}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.sessionTime")}
            </div>
          </div>

          <div
            className={cn(
              "p-6 rounded-lg border",
              "bg-linear-to-br from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950",
              COLORS.semantic.warning.border
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Wrench className={cn("w-8 h-8", COLORS.semantic.warning.icon)} />
            </div>
            <div className={cn("text-2xl font-bold", COLORS.ui.text.primary)}>
              {globalSummary.most_used_tools.length}
            </div>
            <div className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.toolsUsed")}
            </div>
          </div>
        </div>

        {/* First Row: Model Distribution and Most Used Tools */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Model Distribution */}
          {globalSummary.model_distribution.length > 0 && (
            <div
              className={cn(
                "p-6 rounded-lg border",
                COLORS.ui.background.white,
                COLORS.ui.border.medium
              )}
            >
              <h3 className={cn("text-lg font-semibold mb-4", COLORS.ui.text.primary)}>
                {t("analytics.modelDistribution")}
              </h3>
              <div className="space-y-3">
                {globalSummary.model_distribution.map((model) => {
                  const price = calculateModelPrice(
                    model.model_name,
                    model.input_tokens,
                    model.output_tokens,
                    model.cache_creation_tokens,
                    model.cache_read_tokens
                  );
                  return (
                    <div key={model.model_name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn("text-sm font-medium", COLORS.ui.text.primary)}>
                          {model.model_name}
                        </span>
                        <span className={cn("text-sm", COLORS.ui.text.secondary)}>
                          {formatNumber(model.token_count)} tokens (${price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2)})
                        </span>
                      </div>
                      <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
                          style={{
                            width: `${(model.token_count / globalSummary.total_tokens) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Most Used Tools */}
          <div
            className={cn(
              "p-6 rounded-lg border",
              COLORS.ui.background.white,
              COLORS.ui.border.medium
            )}
          >
            <h3
              className={cn(
                "text-lg font-semibold mb-4",
                COLORS.ui.text.primary
              )}
            >
              {t("analytics.mostUsedToolsTitle")}
            </h3>
            {globalSummary.most_used_tools.length > 0 ? (
              <ToolUsageChart tools={globalSummary.most_used_tools} />
            ) : (
              <div className={cn("text-center py-8", COLORS.ui.text.muted)}>
                {t("analytics.No tool usage data available")}
              </div>
            )}
          </div>
        </div>

        {/* Second Row: Activity Heatmap and Top Projects */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity Heatmap */}
          <div
            className={cn(
              "p-6 rounded-lg border",
              COLORS.ui.background.white,
              COLORS.ui.border.medium
            )}
          >
            <h3
              className={cn(
                "text-lg font-semibold mb-4",
                COLORS.ui.text.primary
              )}
            >
              {t("analytics.activityHeatmapTitle")}
            </h3>
            {globalSummary.activity_heatmap.length > 0 ? (
              <ActivityHeatmapComponent
                data={globalSummary.activity_heatmap}
              />
            ) : (
              <div className={cn("text-center py-8", COLORS.ui.text.muted)}>
                {t("analytics.No activity data available")}
              </div>
            )}
          </div>

          {/* Top Projects */}
          {globalSummary.top_projects.length > 0 && (
            <div
              className={cn(
                "p-6 rounded-lg border",
                COLORS.ui.background.white,
                COLORS.ui.border.medium
              )}
            >
              <h3 className={cn("text-lg font-semibold mb-4", COLORS.ui.text.primary)}>
                {t("analytics.topProjects")}
              </h3>
              <div className="space-y-3">
                {globalSummary.top_projects.slice(0, 10).map((project, index) => (
                  <div
                    key={project.project_name}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg",
                      "bg-gray-50 dark:bg-gray-800/50"
                    )}
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                          index === 0 ? "bg-yellow-500 text-white" :
                          index === 1 ? "bg-gray-400 text-white" :
                          index === 2 ? "bg-orange-600 text-white" :
                          "bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                        )}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <p className={cn("font-medium text-sm", COLORS.ui.text.primary)}>
                          {project.project_name}
                        </p>
                        <p className={cn("text-xs", COLORS.ui.text.tertiary)}>
                          {project.sessions} sessions • {project.messages} messages
                        </p>
                      </div>
                    </div>
                    <div className={cn("text-right")}>
                      <p className={cn("font-bold text-sm", COLORS.ui.text.primary)}>
                        {formatNumber(project.tokens)}
                      </p>
                      <p className={cn("text-xs", COLORS.ui.text.tertiary)}>tokens</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Auto-switch to session tab when session is selected
  React.useEffect(() => {
    if (selectedSession && sessionStats && sessionComparison) {
      setActiveTab("session");
    }
  }, [selectedSession, sessionStats, sessionComparison]);

  // Main render logic - Show Global Stats when viewing global stats or no project is selected
  if (isViewingGlobalStats || !selectedProject) {
    if (isLoadingGlobalStats) {
      return (
        <div
          className={cn(
            "flex-1 p-6 flex items-center justify-center",
            COLORS.ui.background.primary
          )}
        >
          <div className="text-center">
            <Loader2 className={cn("w-16 h-16 mx-auto mb-4 animate-spin", COLORS.ui.text.disabled)} />
            <h2 className={cn("text-xl font-semibold mb-2", COLORS.ui.text.primary)}>
              {t("analytics.loadingGlobalStats")}
            </h2>
            <p className={cn("text-sm", COLORS.ui.text.tertiary)}>
              {t("analytics.loadingGlobalStatsDescription")}
            </p>
          </div>
        </div>
      );
    }

    if (globalSummary) {
      return <GlobalStatsView />;
    }

    return (
      <div
        className={cn(
          "flex-1 p-6 flex items-center justify-center",
          COLORS.ui.background.primary
        )}
      >
        <div className="text-center">
          <BarChart3
            className={cn("w-16 h-16 mx-auto mb-4", COLORS.ui.text.disabled)}
          />
          <h2
            className={cn("text-xl font-semibold mb-2", COLORS.ui.text.primary)}
          >
            {t("analytics.Analytics Dashboard")}
          </h2>
          <p className={cn("text-sm", COLORS.ui.text.tertiary)}>
            {t("analytics.Select a project to view analytics")}
          </p>
        </div>
      </div>
    );
  }

  // Project-specific stats
  return (
    <div className={cn("flex-1 p-6 overflow-auto", COLORS.ui.background.primary)}>
      {/* Tab Selector - Only show when session is selected */}
      {selectedSession && sessionStats && sessionComparison && (
        <div className="flex space-x-2 mb-6">
          <button
            onClick={() => setActiveTab("project")}
            className={cn(
              "px-4 py-2 rounded-lg transition-colors font-medium",
              activeTab === "project"
                ? "bg-blue-500 text-white"
                : cn(
                    "bg-gray-200 dark:bg-gray-700",
                    COLORS.ui.text.secondary,
                    "hover:bg-gray-300 dark:hover:bg-gray-600"
                  )
            )}
          >
            {t("analytics.projectOverview")}
          </button>
          <button
            onClick={() => setActiveTab("session")}
            className={cn(
              "px-4 py-2 rounded-lg transition-colors font-medium",
              activeTab === "session"
                ? "bg-blue-500 text-white"
                : cn(
                    "bg-gray-200 dark:bg-gray-700",
                    COLORS.ui.text.secondary,
                    "hover:bg-gray-300 dark:hover:bg-gray-600"
                  )
            )}
          >
            {t("analytics.sessionDetails")}
          </button>
        </div>
      )}

      {/* Render based on active tab */}
      {activeTab === "project" ? <ProjectStatsView /> : <SessionStatsView />}
    </div>
  );
};

// Add display name for debugging
AnalyticsDashboard.displayName = "AnalyticsDashboard";
