"use client";

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, Zap, Database, Eye } from "lucide-react";
import type { SessionTokenStats } from "../types";
import { formatDateCompact } from "../utils/time";
import { cn } from "@/lib/utils";

/**
 * SessionStatsCard - Compact token usage card
 *
 * Displays token breakdown with clean typographic hierarchy.
 */

// Format large numbers
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

// Format duration in minutes to readable string
const formatDuration = (minutes: number): string => {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

export interface SessionStatsCardProps {
  stats: SessionTokenStats;
  showSessionId?: boolean;
  compact?: boolean;
  summary?: string;
}

export const SessionStatsCard = memo(({
  stats,
  showSessionId = false,
  compact = false,
  summary,
}: SessionStatsCardProps) => {
  const { t } = useTranslation();

  const tokenData = [
    { key: "input", label: t("analytics.inputTokens"), value: stats.total_input_tokens, color: "#22c55e", icon: TrendingUp },
    { key: "output", label: t("analytics.outputTokens"), value: stats.total_output_tokens, color: "#a855f7", icon: Zap },
    { key: "cache_create", label: t("analytics.cacheCreation"), value: stats.total_cache_creation_tokens, color: "#3b82f6", icon: Database },
    { key: "cache_read", label: t("analytics.cacheRead"), value: stats.total_cache_read_tokens, color: "#f59e0b", icon: Eye },
  ];

  const activeTokens = tokenData.filter(t => t.value > 0);

  // Calculate session duration
  const durationMs = new Date(stats.last_message_time).getTime() - new Date(stats.first_message_time).getTime();
  const durationMinutes = durationMs / (1000 * 60);

  return (
    <div
      className={cn(
        "relative rounded-lg",
        "bg-card/60 backdrop-blur-sm",
        "border border-border/40",
        "transition-all duration-200",
        "hover:border-border/60"
      )}
    >
      <div className={compact ? "p-3" : "p-4"}>
        {/* Main Stats Row */}
        <div className="flex items-center justify-between gap-4">
          {/* Left: Total & Messages & Duration */}
          <div className="flex items-baseline gap-4">
            <div>
              <span className="font-mono text-lg font-bold text-foreground tabular-nums">
                {formatNumber(stats.total_tokens)}
              </span>
              <span className="text-[10px] text-muted-foreground ml-1">tokens</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="font-mono tabular-nums">{stats.message_count.toLocaleString()}</span>
              <span className="ml-1">{t("analytics.messages")}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="font-mono tabular-nums">{formatDuration(durationMinutes)}</span>
            </div>
          </div>

          {/* Right: Time */}
          <div className="text-[10px] text-muted-foreground/70 font-mono tabular-nums">
            {formatDateCompact(stats.first_message_time)}
          </div>
        </div>

        {/* Token Breakdown - 2 Column Grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 pt-2 border-t border-border/30">
          {activeTokens.map((token) => {
            const Icon = token.icon;
            const percentage = stats.total_tokens > 0 ? (token.value / stats.total_tokens) * 100 : 0;
            return (
              <div key={token.key} className="flex items-center gap-1.5">
                <Icon className="w-3 h-3 shrink-0" style={{ color: token.color }} />
                <span className="text-[10px] text-muted-foreground">{token.label}</span>
                <span
                  className="font-mono text-[11px] font-semibold tabular-nums"
                  style={{ color: token.color }}
                >
                  {formatNumber(token.value)}
                </span>
                <span className="text-[9px] text-muted-foreground/50 tabular-nums">
                  {percentage.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>

        {/* Session ID & Summary - Optional */}
        {(showSessionId || summary) && (
          <div className="mt-2 pt-2 border-t border-border/20 space-y-1">
            {summary && (
              <p className="text-[10px] text-muted-foreground line-clamp-2">
                {summary}
              </p>
            )}
            {showSessionId && (
              <code className="font-mono text-[9px] text-muted-foreground/50 select-all block">
                {stats.session_id}
              </code>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

SessionStatsCard.displayName = "SessionStatsCard";
