"use client";

import React, { useState, useMemo } from "react";
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
  Loader2,
  Cpu,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { ToolUsageStats, ActivityHeatmap } from "../types";
import { formatTime, formatDuration } from "../utils/time";
import { cn } from "@/lib/utils";
import { useAppStore } from "../store/useAppStore";
import { useAnalytics } from "../hooks/useAnalytics";
import { layout } from "./renderers";

/**
 * Analytics Dashboard Component - Mission Control Design
 *
 * Aesthetic: Deep industrial with glowing data visualizations
 * Typography: JetBrains Mono for metrics, IBM Plex Sans for labels
 */
interface AnalyticsDashboardProps {
  isViewingGlobalStats?: boolean;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ isViewingGlobalStats = false }) => {
  const { selectedProject, selectedSession, sessionTokenStats, globalSummary, isLoadingGlobalStats } = useAppStore();

  const { state: analyticsState } = useAnalytics();
  const { t } = useTranslation("components");
  const [activeTab, setActiveTab] = useState<"project" | "session">("project");

  const projectSummary = analyticsState.projectSummary;
  const sessionComparison = analyticsState.sessionComparison;
  const sessionStats = sessionTokenStats;

  // Calculate growth rates
  const calculateGrowthRate = (current: number, previous: number): number => {
    if (previous === 0) return 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  // Format large numbers with precision
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Calculate Claude API pricing
  const calculateModelPrice = (
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number
  ): number => {
    const pricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
      'claude-opus-4-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
      'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
      'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
      'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
      'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
      'claude-3-5-haiku': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
      'claude-3-haiku': { input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
    };

    const defaultPricing = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };
    let modelPricing = pricing['claude-sonnet-4-5'] || defaultPricing;
    for (const [key, value] of Object.entries(pricing)) {
      if (modelName.toLowerCase().includes(key)) {
        modelPricing = value;
        break;
      }
    }

    const inputCost = (inputTokens / 1000000) * modelPricing.input;
    const outputCost = (outputTokens / 1000000) * modelPricing.output;
    const cacheWriteCost = (cacheCreationTokens / 1000000) * modelPricing.cacheWrite;
    const cacheReadCost = (cacheReadTokens / 1000000) * modelPricing.cacheRead;

    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  };

  // Generate 7-day daily data
  const dailyData = useMemo(() => {
    if (!projectSummary?.daily_stats) return [];

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return date.toISOString().split("T")[0];
    });

    return last7Days.map((date) => {
      const dayStats = projectSummary?.daily_stats.find(
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
  }, [projectSummary?.daily_stats]);

  // ============================================
  // METRIC CARD COMPONENT
  // ============================================
  type MetricColorVariant = "green" | "purple" | "blue" | "amber";

  const MetricCard: React.FC<{
    icon: React.ElementType;
    label: string;
    value: string | number;
    subValue?: string;
    trend?: number;
    colorVariant: MetricColorVariant;
  }> = ({ icon: Icon, label, value, subValue, trend, colorVariant }) => {
    const colorVar = `var(--metric-${colorVariant})`;

    return (
      <div
        className={cn(
          "group relative overflow-hidden rounded-xl",
          "bg-card/80 backdrop-blur-sm",
          "border border-border/50",
          "transition-all duration-300",
          "hover:border-border hover:shadow-lg",
        )}
      >
        {/* Glow effect on hover */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, color-mix(in oklch, ${colorVar} 10%, transparent), transparent 70%)`,
            boxShadow: `var(--glow-${colorVariant})`,
          }}
        />

        {/* Top accent line */}
        <div
          className="absolute top-0 left-4 right-4 h-[2px] rounded-b"
          style={{ backgroundColor: colorVar }}
        />

        <div className="relative p-5">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: `color-mix(in oklch, ${colorVar} 20%, transparent)` }}
            >
              <Icon className="w-5 h-5" style={{ color: colorVar }} />
            </div>
            {trend !== undefined && (
              <div
                className={cn(
                  "flex items-center gap-0.5 px-2 py-1 rounded-full font-semibold tracking-wide",
                  layout.smallText,
                  trend > 0
                    ? "bg-success/15 text-success"
                    : trend < 0
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {trend > 0 ? (
                  <ArrowUpRight className="w-3 h-3" />
                ) : trend < 0 ? (
                  <ArrowDownRight className="w-3 h-3" />
                ) : null}
                {trend > 0 ? "+" : ""}{trend}%
              </div>
            )}
          </div>

          {/* Value */}
          <div className="font-mono text-3xl font-bold tracking-tight text-foreground mb-1">
            {value}
          </div>

          {/* Label */}
          <div className={cn(layout.bodyText, "font-medium text-muted-foreground uppercase tracking-wider")}>
            {label}
          </div>

          {/* Sub value */}
          {subValue && (
            <div className={cn("mt-2 text-muted-foreground/70 font-mono", layout.smallText)}>
              {subValue}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // ACTIVITY HEATMAP COMPONENT
  // ============================================
  const ActivityHeatmapComponent = ({ data }: { data: ActivityHeatmap[] }) => {
    const maxActivity = Math.max(...data.map((d) => d.activity_count), 1);
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const days = t("analytics.weekdayNames", { returnObjects: true });

    // Color scale using CSS variables with inline styles
    const getHeatColor = (intensity: number): string => {
      if (intensity === 0) return "var(--heatmap-empty)";
      if (intensity <= 0.3) return "var(--heatmap-low)";
      if (intensity <= 0.6) return "var(--heatmap-medium)";
      return "var(--heatmap-high)";
    };

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
                {hour % 4 === 0 ? hour.toString().padStart(2, '0') : ""}
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
                const activity = data.find(
                  (d) => d.hour === hour && d.day === dayIndex
                );
                const intensity = activity
                  ? activity.activity_count / maxActivity
                  : 0;
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
                        <div className="font-semibold">{day} {hour}:00</div>
                        <div className="text-muted-foreground">
                          {activity?.activity_count || 0} activities
                        </div>
                        <div className="text-muted-foreground">
                          {formatNumber(tokens)} tokens
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-3 mt-4 ml-9">
            <span className={cn("font-medium text-muted-foreground/60 uppercase tracking-wider", layout.smallText)}>
              {t("analytics.legend.less")}
            </span>
            <div className="flex gap-[2px]">
              <div className="w-4 h-4 rounded-[2px]" style={{ backgroundColor: "var(--heatmap-empty)" }} />
              <div className="w-4 h-4 rounded-[2px]" style={{ backgroundColor: "var(--heatmap-low)" }} />
              <div className="w-4 h-4 rounded-[2px]" style={{ backgroundColor: "var(--heatmap-medium)" }} />
              <div className="w-4 h-4 rounded-[2px]" style={{ backgroundColor: "var(--heatmap-high)" }} />
            </div>
            <span className={cn("font-medium text-muted-foreground/60 uppercase tracking-wider", layout.smallText)}>
              {t("analytics.legend.more")}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // TOOL USAGE CHART COMPONENT
  // ============================================
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

    return toolMap[toolName] || toolName;
  };

  const ToolUsageChart = ({ tools }: { tools: ToolUsageStats[] }) => {
    const topTools = tools.slice(0, 6);
    const maxUsage = Math.max(...topTools.map((t) => t.usage_count), 1);
    const totalUsage = topTools.reduce((sum, t) => sum + t.usage_count, 0);

    // Industrial color palette using CSS variables
    const toolColors = [
      { bg: "var(--metric-purple)", glow: "var(--glow-purple)" },
      { bg: "var(--metric-green)", glow: "var(--glow-green)" },
      { bg: "var(--metric-blue)", glow: "var(--glow-blue)" },
      { bg: "var(--metric-amber)", glow: "var(--glow-amber)" },
      { bg: "var(--metric-pink)", glow: "var(--metric-pink)" },
      { bg: "var(--metric-teal)", glow: "var(--metric-teal)" },
    ];

    if (topTools.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Wrench className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-[12px]">{t("analytics.noData")}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {topTools.map((tool, index) => {
          const color = toolColors[index % toolColors.length]!;
          const percentage = totalUsage === 0 ? 0 : (tool.usage_count / totalUsage) * 100;
          const barWidth = (tool.usage_count / maxUsage) * 100;

          return (
            <div key={tool.tool_name} className="group">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: color.bg, boxShadow: `0 0 6px ${color.bg}` }}
                  />
                  <span className="text-[12px] font-medium text-foreground/80">
                    {getToolDisplayName(tool.tool_name)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[12px] font-semibold text-foreground">
                    {tool.usage_count.toLocaleString()}
                  </span>
                  <span className="font-mono text-[12px] text-muted-foreground w-12 text-right">
                    {percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 group-hover:brightness-110"
                  style={{
                    width: `${barWidth}%`,
                    background: color.bg,
                    boxShadow: `0 0 12px ${color.bg}`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ============================================
  // DAILY TREND CHART
  // ============================================
  const DailyTrendChart = () => {
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
                          minHeight: '4px',
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
                          isToday
                            ? "font-bold text-success"
                            : "text-muted-foreground/60"
                        )}
                      >
                        {stat.date?.slice(5).replace('-', '/')}
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
            <div className="w-3 h-3 rounded" style={{ background: "linear-gradient(to top, var(--chart-green-from), var(--chart-green-to))" }} />
            <span className="text-muted-foreground">{t("analytics.today")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ background: "linear-gradient(to top, var(--chart-purple-from), var(--chart-purple-to))" }} />
            <span className="text-muted-foreground">{t("analytics.highActivity")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ background: "linear-gradient(to top, var(--chart-blue-from), var(--chart-blue-to))" }} />
            <span className="text-muted-foreground">{t("analytics.weekend")}</span>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // TOKEN DISTRIBUTION CHART
  // ============================================
  const TokenDistributionChart = ({ distribution, total }: { distribution: { input: number; output: number; cache_creation: number; cache_read: number }; total: number }) => {
    const items = [
      { label: t("analytics.input"), value: distribution.input, color: "var(--metric-green)", icon: TrendingUp },
      { label: t("analytics.output"), value: distribution.output, color: "var(--metric-purple)", icon: Zap },
      { label: t("analytics.cacheCreation"), value: distribution.cache_creation, color: "var(--metric-blue)", icon: Database },
      { label: t("analytics.cacheRead"), value: distribution.cache_read, color: "var(--metric-amber)", icon: Eye },
    ];

    // Guard against division by zero
    const safeTotal = Math.max(total, 1);

    return (
      <div className="space-y-4">
        {/* Stacked bar */}
        <div className="h-4 flex rounded-full overflow-hidden bg-muted/30">
          {items.map((item, i) => {
            const width = (item.value / safeTotal) * 100;
            if (width < 0.5) return null;
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <div
                    className="h-full transition-all hover:brightness-110 cursor-pointer"
                    style={{
                      width: `${width}%`,
                      background: item.color,
                      marginLeft: i > 0 ? '1px' : 0,
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent className="font-mono text-xs">
                  <div>{item.label}: {formatNumber(item.value)} ({((item.value / safeTotal) * 100).toFixed(1)}%)</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Legend items */}
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => {
            const Icon = item.icon;
            const percentage = (item.value / safeTotal) * 100;
            return (
              <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center"
                    style={{ background: `${item.color}20` }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                  </div>
                  <span className="text-[12px] font-medium text-foreground/70">{item.label}</span>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[12px] font-semibold" style={{ color: item.color }}>
                    {formatNumber(item.value)}
                  </div>
                  <div className="font-mono text-[12px] text-muted-foreground">
                    {percentage.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Total */}
        <div className="pt-3 border-t border-border/50 text-center">
          <div className="font-mono text-2xl font-bold text-foreground tracking-tight">
            {formatNumber(total)}
          </div>
          <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("analytics.totalTokenUsage")}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // SECTION CARD WRAPPER
  // ============================================
  type SectionColorVariant = "green" | "purple" | "blue" | "amber" | "accent";

  const SectionCard: React.FC<{
    title: string;
    icon?: React.ElementType;
    colorVariant?: SectionColorVariant;
    children: React.ReactNode;
    className?: string;
  }> = ({ title, icon: Icon, colorVariant = "accent", children, className }) => {
    const colorVar = colorVariant === "accent" ? "var(--accent)" : `var(--metric-${colorVariant})`;

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-xl",
          "bg-card/60 backdrop-blur-sm",
          "border border-border/50",
          className
        )}
      >
        {/* Top accent line */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: `linear-gradient(90deg, transparent, ${colorVar}, transparent)` }}
        />

        <div className="p-5">
          {/* Header */}
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
            {Icon && (
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: `color-mix(in oklch, ${colorVar} 15%, transparent)` }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: colorVar }} />
              </div>
            )}
            {title}
          </h3>

          {children}
        </div>
      </div>
    );
  };

  // ============================================
  // PROJECT STATS VIEW
  // ============================================
  const ProjectStatsView = () => {
    if (!projectSummary) {
      if (analyticsState.isLoadingProjectSummary) {
        return (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-4">
              <div className="relative">
                <Loader2 className="w-12 h-12 mx-auto animate-spin text-accent/50" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-accent animate-pulse" />
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t("analytics.loading")}
              </p>
            </div>
          </div>
        );
      }
      return null;
    }

    const lastDayStats = projectSummary.daily_stats[projectSummary.daily_stats.length - 1];
    const prevDayStats = projectSummary.daily_stats[projectSummary.daily_stats.length - 2];
    const tokenGrowth = lastDayStats && prevDayStats
      ? calculateGrowthRate(lastDayStats.total_tokens, prevDayStats.total_tokens)
      : 0;
    const messageGrowth = lastDayStats && prevDayStats
      ? calculateGrowthRate(lastDayStats.message_count, prevDayStats.message_count)
      : 0;

    return (
      <div className="space-y-6 animate-stagger">
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={MessageCircle}
            label={t("analytics.totalMessages")}
            value={formatNumber(projectSummary.total_messages)}
            trend={messageGrowth}
            colorVariant="purple"
          />
          <MetricCard
            icon={Activity}
            label={t("analytics.totalTokens")}
            value={formatNumber(projectSummary.total_tokens)}
            trend={tokenGrowth}
            subValue={`${projectSummary.total_sessions} sessions`}
            colorVariant="blue"
          />
          <MetricCard
            icon={Clock}
            label={t("analytics.totalSessionTime")}
            value={formatDuration(projectSummary.total_session_duration)}
            subValue={`avg: ${formatDuration(projectSummary.avg_session_duration)}`}
            colorVariant="green"
          />
          <MetricCard
            icon={Wrench}
            label={t("analytics.toolsUsed")}
            value={projectSummary.most_used_tools.length}
            colorVariant="amber"
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SectionCard
            title={t("analytics.activityHeatmapTitle")}
            icon={Layers}
            colorVariant="green"
          >
            {projectSummary.activity_heatmap.length > 0 ? (
              <ActivityHeatmapComponent data={projectSummary.activity_heatmap} />
            ) : (
              <div className="text-center py-8 text-muted-foreground text-[12px]">
                {t("analytics.No activity data available")}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={t("analytics.mostUsedToolsTitle")}
            icon={Cpu}
            colorVariant="purple"
          >
            <ToolUsageChart tools={projectSummary.most_used_tools} />
          </SectionCard>
        </div>

        {/* Daily Trend Chart */}
        {projectSummary.daily_stats.length > 0 && (
          <SectionCard
            title={t("analytics.recentActivityTrend")}
            icon={TrendingUp}
            colorVariant="blue"
          >
            <DailyTrendChart />
          </SectionCard>
        )}

        {/* Token Distribution */}
        <SectionCard
          title={t("analytics.tokenTypeDistribution")}
          icon={Database}
          colorVariant="amber"
        >
          <TokenDistributionChart
            distribution={projectSummary.token_distribution}
            total={projectSummary.total_tokens}
          />
        </SectionCard>
      </div>
    );
  };

  // ============================================
  // SESSION STATS VIEW
  // ============================================
  const SessionStatsView = () => {
    if (!sessionStats || !sessionComparison) return null;

    const avgTokensPerMessage = sessionStats.message_count > 0
      ? Math.round(sessionStats.total_tokens / sessionStats.message_count)
      : 0;

    const sessionDuration =
      new Date(sessionStats.last_message_time).getTime() -
      new Date(sessionStats.first_message_time).getTime();
    const durationMinutes = Math.round(sessionDuration / (1000 * 60));

    const distribution = {
      input: sessionStats.total_input_tokens,
      output: sessionStats.total_output_tokens,
      cache_creation: sessionStats.total_cache_creation_tokens,
      cache_read: sessionStats.total_cache_read_tokens,
    };

    return (
      <div className="space-y-6 animate-stagger">
        {/* Performance Banner */}
        <div
          className={cn(
            "relative overflow-hidden rounded-xl p-5",
            "border-2",
            sessionComparison.is_above_average
              ? "bg-success/5 border-success/30"
              : "bg-warning/5 border-warning/30"
          )}
        >
          {/* Glow effect */}
          <div
            className={cn(
              "absolute inset-0 pointer-events-none",
              sessionComparison.is_above_average
                ? "bg-[radial-gradient(ellipse_at_50%_0%,_var(--metric-green)_/_0.1,_transparent_60%)]"
                : "bg-[radial-gradient(ellipse_at_50%_0%,_var(--metric-amber)_/_0.1,_transparent_60%)]"
            )}
          />

          <div className="relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-foreground">
                {t("analytics.performanceInsights")}
              </h3>
              <div
                className={cn(
                  "px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-wider",
                  sessionComparison.is_above_average
                    ? "bg-success/20 text-success"
                    : "bg-warning/20 text-warning"
                )}
              >
                {sessionComparison.is_above_average
                  ? t("analytics.aboveAverage")
                  : t("analytics.belowAverage")}
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="text-center">
                <div className="font-mono text-3xl font-bold text-foreground">
                  #{sessionComparison.rank_by_tokens}
                </div>
                <div className="text-[12px] text-muted-foreground mt-1">
                  {t("analytics.tokenRank")}
                </div>
                <div className="text-[12px] text-muted-foreground/70 mt-0.5">
                  {t("analytics.topPercent", {
                    percent: ((sessionComparison.rank_by_tokens / (projectSummary?.total_sessions || 1)) * 100).toFixed(0),
                  })}
                </div>
              </div>

              <div className="text-center">
                <div className="font-mono text-3xl font-bold text-foreground">
                  {sessionComparison.percentage_of_project_tokens.toFixed(1)}%
                </div>
                <div className="text-[12px] text-muted-foreground mt-1">
                  {t("analytics.projectShare")}
                </div>
                <div className="text-[12px] text-muted-foreground/70 mt-0.5">
                  {formatNumber(sessionStats.total_tokens)} {t("analytics.tokens")}
                </div>
              </div>

              <div className="text-center">
                <div className="font-mono text-3xl font-bold text-foreground">
                  {avgTokensPerMessage.toLocaleString()}
                </div>
                <div className="text-[12px] text-muted-foreground mt-1">
                  {t("analytics.tokensPerMessage")}
                </div>
                <div className="text-[12px] text-muted-foreground/70 mt-0.5">
                  {t("analytics.totalMessagesCount", { count: sessionStats.message_count })}
                </div>
              </div>

              <div className="text-center">
                <div className="font-mono text-3xl font-bold text-foreground">
                  {durationMinutes}<span className="text-lg text-muted-foreground">m</span>
                </div>
                <div className="text-[12px] text-muted-foreground mt-1">
                  {t("analytics.sessionTime")}
                </div>
                <div className="text-[12px] text-muted-foreground/70 mt-0.5">
                  {t("analytics.rank", { rank: sessionComparison.rank_by_duration })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Token Distribution */}
        <SectionCard
          title={t("analytics.tokenAnalysis")}
          icon={BarChart3}
          colorVariant="purple"
        >
          <TokenDistributionChart
            distribution={distribution}
            total={sessionStats.total_tokens}
          />
        </SectionCard>

        {/* Session Timeline */}
        <SectionCard
          title={t("analytics.sessionTimeline")}
          icon={Clock}
          colorVariant="green"
        >
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
              <div>
                <div className="text-[12px] font-medium text-foreground/80">
                  {t("analytics.startTime")}
                </div>
                <div className="font-mono text-[12px] text-muted-foreground">
                  {formatTime(sessionStats.first_message_time)}
                </div>
              </div>
              <div className="text-center px-4">
                <div className="text-[12px] font-medium text-foreground/80">
                  {t("analytics.duration")}
                </div>
                <div className="font-mono text-[12px] text-muted-foreground">
                  {durationMinutes}{t("analytics.minutesUnit")}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] font-medium text-foreground/80">
                  {t("analytics.endTime")}
                </div>
                <div className="font-mono text-[12px] text-muted-foreground">
                  {formatTime(sessionStats.last_message_time)}
                </div>
              </div>
            </div>

            <div className="text-center">
              <code className="inline-block px-3 py-1.5 bg-muted/50 rounded-md font-mono text-[12px] text-muted-foreground">
                {t("analytics.sessionIdLabel")} {sessionStats.session_id.substring(0, 16)}...
              </code>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  };

  // ============================================
  // GLOBAL STATS VIEW
  // ============================================
  const GlobalStatsView = () => {
    if (!globalSummary) return null;

    const totalSessionTime = globalSummary.total_session_duration_minutes;

    return (
      <div className="flex-1 p-6 overflow-auto bg-background space-y-6 animate-stagger">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={Activity}
            label={t("analytics.totalTokens")}
            value={formatNumber(globalSummary.total_tokens)}
            subValue={`${globalSummary.total_projects} ${t("analytics.totalProjects")}`}
            colorVariant="blue"
          />
          <MetricCard
            icon={MessageCircle}
            label={t("analytics.totalMessages")}
            value={formatNumber(globalSummary.total_messages)}
            subValue={`${t("analytics.totalSessions")}: ${globalSummary.total_sessions}`}
            colorVariant="purple"
          />
          <MetricCard
            icon={Clock}
            label={t("analytics.sessionTime")}
            value={formatDuration(totalSessionTime)}
            colorVariant="green"
          />
          <MetricCard
            icon={Wrench}
            label={t("analytics.toolsUsed")}
            value={globalSummary.most_used_tools.length}
            colorVariant="amber"
          />
        </div>

        {/* Model Distribution & Tool Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {globalSummary.model_distribution.length > 0 && (
            <SectionCard
              title={t("analytics.modelDistribution")}
              icon={Cpu}
              colorVariant="blue"
            >
              <div className="space-y-3">
                {globalSummary.model_distribution.map((model) => {
                  const price = calculateModelPrice(
                    model.model_name,
                    model.input_tokens,
                    model.output_tokens,
                    model.cache_creation_tokens,
                    model.cache_read_tokens
                  );
                  const percentage = (model.token_count / Math.max(globalSummary.total_tokens, 1)) * 100;

                  return (
                    <div key={model.model_name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[12px] font-medium text-foreground truncate max-w-[60%]">
                          {model.model_name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-muted-foreground">
                            ${price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2)}
                          </span>
                          <span className="font-mono text-[12px] font-semibold text-foreground">
                            {formatNumber(model.token_count)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percentage}%`,
                            background: "linear-gradient(90deg, var(--metric-purple), var(--metric-blue))"
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          <SectionCard
            title={t("analytics.mostUsedToolsTitle")}
            icon={Wrench}
            colorVariant="amber"
          >
            <ToolUsageChart tools={globalSummary.most_used_tools} />
          </SectionCard>
        </div>

        {/* Heatmap & Top Projects */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SectionCard
            title={t("analytics.activityHeatmapTitle")}
            icon={Layers}
            colorVariant="green"
          >
            {globalSummary.activity_heatmap.length > 0 ? (
              <ActivityHeatmapComponent data={globalSummary.activity_heatmap} />
            ) : (
              <div className="text-center py-8 text-muted-foreground text-[12px]">
                {t("analytics.No activity data available")}
              </div>
            )}
          </SectionCard>

          {globalSummary.top_projects.length > 0 && (
            <SectionCard
              title={t("analytics.topProjects")}
              icon={BarChart3}
              colorVariant="purple"
            >
              <div className="space-y-2">
                {globalSummary.top_projects.slice(0, 8).map((project, index) => {
                  const medals = ["🥇", "🥈", "🥉"];
                  return (
                    <div
                      key={project.project_name}
                      className={cn(
                        "flex items-center justify-between p-2.5 rounded-lg",
                        "bg-muted/30 hover:bg-muted/50 transition-colors"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold",
                            index < 3 ? "text-base" : "bg-muted text-muted-foreground"
                          )}
                        >
                          {index < 3 ? medals[index] : index + 1}
                        </div>
                        <div>
                          <p className="text-[12px] font-medium text-foreground truncate max-w-[150px]">
                            {project.project_name}
                          </p>
                          <p className="text-[12px] text-muted-foreground">
                            {project.sessions} sessions • {project.messages} msgs
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-[12px] font-bold text-foreground">
                          {formatNumber(project.tokens)}
                        </p>
                        <p className="text-[12px] text-muted-foreground">{t("analytics.tokens")}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // EFFECTS
  // ============================================
  React.useEffect(() => {
    if (selectedSession && sessionStats && sessionComparison) {
      setActiveTab("session");
    } else {
      setActiveTab("project");
    }
  }, [selectedSession, sessionStats, sessionComparison]);

  React.useEffect(() => {
    setActiveTab("project");
  }, [selectedProject?.name]);

  // ============================================
  // MAIN RENDER
  // ============================================
  if (isViewingGlobalStats || !selectedProject) {
    if (isLoadingGlobalStats) {
      return (
        <div className="flex-1 p-6 flex items-center justify-center bg-background">
          <div className="text-center space-y-4">
            <div className="relative">
              <Loader2 className="w-14 h-14 mx-auto animate-spin text-accent/40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-accent animate-pulse" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-1">
                {t("analytics.loadingGlobalStats")}
              </h2>
              <p className="text-[12px] text-muted-foreground">
                {t("analytics.loadingGlobalStatsDescription")}
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (globalSummary) {
      return <GlobalStatsView />;
    }

    return (
      <div className="flex-1 p-6 flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="relative">
            <BarChart3 className="w-14 h-14 mx-auto text-muted-foreground/30" />
            <div
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--metric-purple)_/_0.1,_transparent_70%)]"
            />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">
              {t("analytics.Analytics Dashboard")}
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {t("analytics.Select a project to view analytics")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const hasSessionData = selectedSession && sessionStats && sessionComparison;

  return (
    <div className="flex-1 p-6 overflow-auto bg-background">
      {/* Tab Selector */}
      {hasSessionData && (
        <div className="inline-flex p-1 mb-6 rounded-lg bg-muted/50 border border-border/50">
          <button
            onClick={() => setActiveTab("project")}
            className={cn(
              "px-4 py-2 rounded-md text-[12px] font-semibold transition-all duration-200",
              activeTab === "project"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("analytics.projectOverview")}
          </button>
          <button
            onClick={() => setActiveTab("session")}
            className={cn(
              "px-4 py-2 rounded-md text-[12px] font-semibold transition-all duration-200",
              activeTab === "session"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("analytics.sessionDetails")}
          </button>
        </div>
      )}

      {hasSessionData && activeTab === "session" ? <SessionStatsView /> : <ProjectStatsView />}
    </div>
  );
};

AnalyticsDashboard.displayName = "AnalyticsDashboard";
