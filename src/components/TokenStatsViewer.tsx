"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  TrendingUp,
  MessageSquare,
  Database,
  Zap,
  Eye,
  Hash,
  Sparkles,
  Layers,
} from "lucide-react";
import type { SessionTokenStats } from "../types";
import { formatTime } from "../utils/time";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Token Stats Viewer - Mission Control Design
 *
 * Displays token usage statistics with industrial luxury aesthetics:
 * - OKLCH color gradients for visual depth
 * - Glowing progress bars
 * - Monospace typography for data
 */
interface TokenStatsViewerProps {
  sessionStats?: SessionTokenStats | null;
  projectStats?: SessionTokenStats[];
  title?: string;
}

export const TokenStatsViewer: React.FC<TokenStatsViewerProps> = ({
  sessionStats,
  projectStats = [],
  title,
}) => {
  const { t } = useTranslation("components");

  // Format large numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // Token type colors using CSS variables
  const tokenColors = {
    input: {
      base: "var(--metric-green)",
      glow: "var(--glow-green)",
      bg: "color-mix(in oklch, var(--metric-green) 10%, transparent)"
    },
    output: {
      base: "var(--metric-purple)",
      glow: "var(--glow-purple)",
      bg: "color-mix(in oklch, var(--metric-purple) 10%, transparent)"
    },
    cacheWrite: {
      base: "var(--metric-blue)",
      glow: "var(--glow-blue)",
      bg: "color-mix(in oklch, var(--metric-blue) 10%, transparent)"
    },
    cacheRead: {
      base: "var(--metric-amber)",
      glow: "var(--glow-amber)",
      bg: "color-mix(in oklch, var(--metric-amber) 10%, transparent)"
    },
  };

  // ============================================
  // SINGLE SESSION STATS COMPONENT
  // ============================================
  const SessionStatsCard = ({
    stats,
    showSessionId = false,
    compact = false,
  }: {
    stats: SessionTokenStats;
    showSessionId?: boolean;
    compact?: boolean;
  }) => {
    const tokenTypes = [
      { key: "input", label: t("analytics.inputTokens"), value: stats.total_input_tokens, color: tokenColors.input, icon: TrendingUp },
      { key: "output", label: t("analytics.outputTokens"), value: stats.total_output_tokens, color: tokenColors.output, icon: Zap },
      { key: "cacheWrite", label: t("analytics.cacheCreation"), value: stats.total_cache_creation_tokens, color: tokenColors.cacheWrite, icon: Database },
      { key: "cacheRead", label: t("analytics.cacheRead"), value: stats.total_cache_read_tokens, color: tokenColors.cacheRead, icon: Eye },
    ];

    const maxTokens = Math.max(...tokenTypes.map((t) => t.value), 1);

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-xl",
          "bg-card/60 backdrop-blur-sm",
          "border border-border/50",
          "transition-all duration-300",
          "hover:border-border hover:shadow-md"
        )}
      >
        {/* Top gradient accent */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, var(--metric-green), var(--metric-purple), var(--metric-amber))" }}
        />

        <div className={compact ? "p-4" : "p-5"}>
          {/* Session ID Header */}
          {showSessionId && (
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border/50">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: tokenColors.input.bg }}
              >
                <Hash className="w-3.5 h-3.5" style={{ color: tokenColors.input.base }} />
              </div>
              <code className="font-mono text-[12px] px-2 py-1 rounded-md bg-muted/50 text-muted-foreground">
                {stats.session_id.substring(0, 12)}...
              </code>
            </div>
          )}

          {/* Token Breakdown */}
          <div className="space-y-3 mb-5">
            {tokenTypes.map((token) => {
              const Icon = token.icon;
              const percentage = stats.total_tokens > 0 ? (token.value / stats.total_tokens) * 100 : 0;
              const barWidth = (token.value / maxTokens) * 100;

              return (
                <div key={token.key} className="group">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-md flex items-center justify-center transition-transform group-hover:scale-110"
                        style={{ background: token.color.bg }}
                      >
                        <Icon className="w-3 h-3" style={{ color: token.color.base }} />
                      </div>
                      <span className="text-[12px] font-medium text-muted-foreground">
                        {token.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-bold" style={{ color: token.color.base }}>
                        {formatNumber(token.value)}
                      </span>
                      <span className="font-mono text-[12px] text-muted-foreground/70 w-10 text-right">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="relative h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 group-hover:brightness-110"
                      style={{
                        width: `${barWidth}%`,
                        background: token.color.base,
                        boxShadow: `0 0 10px ${token.color.glow}`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary Row */}
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border/50">
            {/* Total Tokens */}
            <div className="text-center">
              <div className="font-mono text-xl font-bold text-foreground tracking-tight">
                {formatNumber(stats.total_tokens)}
              </div>
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
                {t("analytics.totalTokens")}
              </div>
            </div>

            {/* Messages */}
            <div className="text-center border-x border-border/30">
              <div className="font-mono text-xl font-bold text-foreground tracking-tight">
                {stats.message_count.toLocaleString()}
              </div>
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
                {t("analytics.messages")}
              </div>
            </div>

            {/* Avg per Message */}
            <div className="text-center">
              <div className="font-mono text-xl font-bold text-foreground tracking-tight">
                {stats.message_count > 0
                  ? Math.round(stats.total_tokens / stats.message_count).toLocaleString()
                  : "0"}
              </div>
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
                {t("analytics.avgTokensPerMessage")}
              </div>
            </div>
          </div>

          {/* Time Range Footer */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              {t("time.start")} {formatTime(stats.first_message_time)}
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
              {t("time.end")} {formatTime(stats.last_message_time)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // PROJECT STATS VIEW
  // ============================================
  const renderProjectStats = () => {
    if (!projectStats.length) return null;

    const totalStats = projectStats.reduce(
      (acc, stats) => ({
        total_input_tokens: acc.total_input_tokens + stats.total_input_tokens,
        total_output_tokens: acc.total_output_tokens + stats.total_output_tokens,
        total_cache_creation_tokens: acc.total_cache_creation_tokens + stats.total_cache_creation_tokens,
        total_cache_read_tokens: acc.total_cache_read_tokens + stats.total_cache_read_tokens,
        total_tokens: acc.total_tokens + stats.total_tokens,
        message_count: acc.message_count + stats.message_count,
      }),
      {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_creation_tokens: 0,
        total_cache_read_tokens: 0,
        total_tokens: 0,
        message_count: 0,
      }
    );

    const metrics = [
      { label: t("analytics.totalTokens"), value: totalStats.total_tokens, color: "var(--metric-purple)" },
      { label: t("analytics.inputTokens"), value: totalStats.total_input_tokens, color: tokenColors.input.base },
      { label: t("analytics.outputTokens"), value: totalStats.total_output_tokens, color: tokenColors.output.base },
      { label: t("analytics.cacheCreation"), value: totalStats.total_cache_creation_tokens, color: tokenColors.cacheWrite.base },
      { label: t("analytics.totalMessages"), value: totalStats.message_count, color: "var(--muted-foreground)" },
    ];

    return (
      <div className="space-y-6">
        {/* Project Summary Card */}
        <div
          className="relative overflow-hidden rounded-xl border-2 border-metric-green/30"
        >
          {/* Background gradient */}
          <div
            className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_30%_0%,_var(--metric-green)_/_0.08,_transparent_50%),_radial-gradient(ellipse_at_70%_100%,_var(--metric-purple)_/_0.05,_transparent_50%)]"
          />

          <div className="relative p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ background: "color-mix(in oklch, var(--metric-green) 15%, transparent)" }}
              >
                <Layers className="w-5 h-5" style={{ color: "var(--metric-green)" }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("analytics.projectStats", { count: projectStats.length })}
                </h3>
                <p className="text-[12px] text-muted-foreground">
                  {t("analytics.globalOverviewDescription")}
                </p>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {metrics.map((metric, i) => (
                <Tooltip key={metric.label}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "relative p-4 rounded-xl text-center",
                        "bg-card/80 backdrop-blur-sm",
                        "border border-border/50",
                        "transition-all duration-300",
                        "hover:border-border hover:shadow-md hover:scale-[1.02] cursor-default"
                      )}
                    >
                      {/* Top accent */}
                      <div
                        className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-[2px] rounded-b"
                        style={{ background: metric.color }}
                      />
                      <div
                        className="font-mono text-2xl font-bold tracking-tight"
                        style={{ color: i === 0 ? "var(--foreground)" : metric.color }}
                      >
                        {formatNumber(metric.value)}
                      </div>
                      <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
                        {metric.label}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="font-mono text-xs">
                    {metric.value.toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>

        {/* Individual Sessions */}
        <div className="space-y-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <div className="w-1.5 h-5 rounded-full bg-accent" />
            {t("analytics.sessionStatsDetail")}
          </h4>

          <div className="space-y-3">
            {projectStats.slice(0, 10).map((stats, index) => (
              <div
                key={`session-${stats.session_id}-${index}`}
                className="animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[12px] font-bold text-foreground bg-accent/10 px-2.5 py-1 rounded-full">
                    {t("analytics.sessionNumber", { number: index + 1 })}
                  </span>
                  <span className="text-[12px] text-muted-foreground font-mono">
                    {formatTime(stats.last_message_time)}
                  </span>
                </div>
                <SessionStatsCard stats={stats} showSessionId compact />
              </div>
            ))}

            {projectStats.length > 10 && (
              <div className="text-center py-4 text-muted-foreground bg-muted/30 rounded-xl text-[12px]">
                {t("analytics.andMoreSessions", { count: projectStats.length - 10 })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // EMPTY STATE
  // ============================================
  if (!sessionStats && !projectStats.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-border/50 bg-card/30">
        <div className="relative mb-4">
          <BarChart3 className="w-14 h-14 text-muted-foreground/30" />
          <div
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--metric-purple)_/_0.1,_transparent_70%)]"
          />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          {t("analytics.noTokenData")}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {t("analytics.selectSessionOrLoad")}
        </p>
      </div>
    );
  }

  // ============================================
  // MAIN RENDER
  // ============================================
  return (
    <div className="space-y-6">
      {/* Header */}
      {title && (
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "color-mix(in oklch, var(--metric-purple) 15%, transparent)" }}
          >
            <Sparkles className="w-4 h-4" style={{ color: "var(--metric-purple)" }} />
          </div>
          <h2 className="text-lg font-semibold text-foreground tracking-tight">
            {title}
          </h2>
        </div>
      )}

      {/* Current Session */}
      {sessionStats && (
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground/80 mb-3">
            <MessageSquare className="w-4 h-4 text-accent" />
            {t("analytics.currentSession")}
          </h3>
          <SessionStatsCard stats={sessionStats} />
        </div>
      )}

      {/* Project Stats */}
      {projectStats.length > 0 && renderProjectStats()}
    </div>
  );
};

TokenStatsViewer.displayName = "TokenStatsViewer";
