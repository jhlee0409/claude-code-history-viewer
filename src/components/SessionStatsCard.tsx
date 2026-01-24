"use client";

import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  TrendingUp,
  Database,
  Zap,
  Eye,
  Hash,
} from "lucide-react";
import type { SessionTokenStats } from "../types";
import { formatTime } from "../utils/time";
import { cn } from "@/lib/utils";

/**
 * SessionStatsCard - Token usage statistics card
 *
 * Displays token breakdown with progress bars and summary metrics.
 * Extracted from TokenStatsViewer for performance optimization.
 */

// Static token colors - matches TokenStatsViewer
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

// Format large numbers
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

export interface SessionStatsCardProps {
  stats: SessionTokenStats;
  showSessionId?: boolean;
  compact?: boolean;
}

export const SessionStatsCard = memo(({
  stats,
  showSessionId = false,
  compact = false,
}: SessionStatsCardProps) => {
  const { t } = useTranslation();
  const tokenColors = TOKEN_COLORS;

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
});

SessionStatsCard.displayName = "SessionStatsCard";
