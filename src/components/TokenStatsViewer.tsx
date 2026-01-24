"use client";

import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  MessageSquare,
  Sparkles,
  Layers,
  ChevronDown,
  Loader2,
} from "lucide-react";
import type { SessionTokenStats } from "../types";
import type { ProjectTokenStatsPagination } from "../store/slices/messageSlice";
import { formatTime } from "../utils/time";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { LoadingState } from "./ui/loading";
import { SessionStatsCard } from "./SessionStatsCard";

/**
 * Token Stats Viewer - Mission Control Design
 *
 * Displays token usage statistics with industrial luxury aesthetics:
 * - OKLCH color gradients for visual depth
 * - Glowing progress bars
 * - Monospace typography for data
 */

// Static token colors - defined outside component to avoid recreation on every render
const TOKEN_COLORS = {
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
} as const;

interface TokenStatsViewerProps {
  sessionStats?: SessionTokenStats | null;
  projectStats?: SessionTokenStats[];
  pagination?: ProjectTokenStatsPagination;
  onLoadMore?: () => void;
  title?: string;
  isLoading?: boolean;
}

export const TokenStatsViewer: React.FC<TokenStatsViewerProps> = ({
  sessionStats,
  projectStats = [],
  pagination,
  onLoadMore,
  title,
  isLoading = false,
}) => {
  const { t } = useTranslation();

  // Use projectStats directly - pagination is handled by backend
  const displayedSessions = useMemo(() => projectStats, [projectStats]);

  const hasMoreSessions = pagination?.hasMore ?? false;
  const isLoadingMore = pagination?.isLoadingMore ?? false;
  const totalCount = pagination?.totalCount ?? projectStats.length;
  const remainingCount = totalCount - projectStats.length;

  // Handle "Show More" click - calls backend via onLoadMore
  const handleShowMore = useCallback(() => {
    if (onLoadMore && hasMoreSessions && !isLoadingMore) {
      onLoadMore();
    }
  }, [onLoadMore, hasMoreSessions, isLoadingMore]);

  // Format large numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // Use static token colors for metrics display
  const tokenColors = TOKEN_COLORS;

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
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <div className="w-1.5 h-5 rounded-full bg-accent" />
              {t("analytics.sessionStatsDetail")}
            </h4>
            <span className="text-[11px] text-muted-foreground font-mono">
              {projectStats.length} / {totalCount}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {displayedSessions.map((stats, index) => (
              <div
                key={`session-${stats.session_id}-${index}`}
                className="animate-slide-up"
                style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
              >
                <SessionStatsCard stats={stats} showSessionId compact summary={stats.summary} />
              </div>
            ))}

            {/* Show More Button */}
            {hasMoreSessions && (
              <button
                type="button"
                onClick={handleShowMore}
                disabled={isLoadingMore}
                aria-label={t("analytics.showMoreSessions", { count: Math.min(pagination?.limit ?? 20, remainingCount) })}
                className={cn(
                  "w-full py-4 rounded-xl text-[13px] font-medium",
                  "bg-muted/30 hover:bg-muted/50",
                  "border border-border/50 hover:border-border",
                  "text-muted-foreground hover:text-foreground",
                  "transition-all duration-200",
                  "flex items-center justify-center gap-2",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("common.loading")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    {t("analytics.showMoreSessions", { count: Math.min(pagination?.limit ?? 20, remainingCount) })}
                    <span className="text-muted-foreground/70">
                      ({remainingCount} {t("analytics.remaining")})
                    </span>
                  </>
                )}
              </button>
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
    <LoadingState
      isLoading={isLoading}
      loadingMessage={t("analytics.loading")}
      withSparkle
      spinnerSize="lg"
      minHeight="py-24"
    >
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
    </LoadingState>
  );
};

TokenStatsViewer.displayName = "TokenStatsViewer";
