/**
 * SessionStatsView Component
 *
 * Clean session analytics with performance metrics and timeline.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Clock, TrendingUp, TrendingDown, Zap, MessageSquare, Timer } from "lucide-react";
import type { SessionTokenStats, SessionComparison } from "../../../types";
import { formatTime } from "../../../utils/time";
import { SectionCard, TokenDistributionChart } from "../components";
import {
  formatNumber,
  calculateSessionMetrics,
  calculateSessionComparisonMetrics,
} from "../utils";

interface SessionStatsViewProps {
  sessionStats: SessionTokenStats;
  sessionComparison: SessionComparison;
  totalProjectSessions?: number;
}

export const SessionStatsView: React.FC<SessionStatsViewProps> = ({
  sessionStats,
  sessionComparison,
  totalProjectSessions = 1,
}) => {
  const { t } = useTranslation();

  // Memoized session metrics calculation
  const { avgTokensPerMessage, durationMinutes, distribution } = useMemo(
    () => calculateSessionMetrics(sessionStats),
    [sessionStats]
  );

  // Memoized comparison metrics calculation
  const { isAboveAverage, statusColor, percentile } = useMemo(
    () => calculateSessionComparisonMetrics(sessionComparison, totalProjectSessions),
    [sessionComparison, totalProjectSessions]
  );

  return (
    <div className="space-y-6">
      {/* Performance Banner */}
      <div className="rounded-lg bg-card/80 backdrop-blur-sm border border-border/40 overflow-hidden">
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {t("analytics.performanceInsights")}
              </h3>
              <div className="flex items-center gap-2">
                {isAboveAverage ? (
                  <TrendingUp className="w-4 h-4" style={{ color: statusColor }} />
                ) : (
                  <TrendingDown className="w-4 h-4" style={{ color: statusColor }} />
                )}
                <span className="text-base font-bold" style={{ color: statusColor }}>
                  {isAboveAverage ? t("analytics.aboveAverage") : t("analytics.belowAverage")}
                </span>
              </div>
            </div>

            {/* Rank badge */}
            <div
              className="px-3 py-2 rounded-md"
              style={{ background: `color-mix(in oklch, ${statusColor} 10%, transparent)` }}
            >
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.tokenRank")}
              </div>
              <div className="font-mono text-xl font-bold tabular-nums" style={{ color: statusColor }}>
                #{sessionComparison.rank_by_tokens}
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.projectShare")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                {sessionComparison.percentage_of_project_tokens.toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {formatNumber(sessionStats.total_tokens)} tokens
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.tokensPerMessage")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                {avgTokensPerMessage.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {sessionStats.message_count} messages
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Timer className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.sessionTime")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                {durationMinutes}<span className="text-base text-muted-foreground/50">m</span>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                Rank #{sessionComparison.rank_by_duration}
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                  Percentile
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                {percentile}%
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                of {totalProjectSessions} sessions
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Token Distribution */}
      <SectionCard title={t("analytics.tokenAnalysis")} icon={BarChart3} colorVariant="purple">
        <TokenDistributionChart distribution={distribution} total={sessionStats.total_tokens} />
      </SectionCard>

      {/* Session Timeline */}
      <SectionCard title={t("analytics.sessionTimeline")} icon={Clock} colorVariant="green">
        <div className="space-y-4">
          <div className="relative flex items-center justify-between">
            {/* Start */}
            <div className="text-center z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-metric-green mb-2 mx-auto" />
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.startTime")}
              </div>
              <div className="font-mono text-[11px] text-foreground mt-0.5">
                {formatTime(sessionStats.first_message_time)}
              </div>
            </div>

            {/* Connection line */}
            <div className="absolute left-6 right-6 top-1 h-px bg-gradient-to-r from-metric-green via-border to-metric-amber" />

            {/* Duration */}
            <div className="text-center z-10 px-3 py-1.5 bg-card rounded-md border border-border/40">
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.duration")}
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {durationMinutes}<span className="text-sm text-muted-foreground/50">{t("analytics.minutesUnit")}</span>
              </div>
            </div>

            {/* End */}
            <div className="text-center z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-metric-amber mb-2 mx-auto" />
              <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.endTime")}
              </div>
              <div className="font-mono text-[11px] text-foreground mt-0.5">
                {formatTime(sessionStats.last_message_time)}
              </div>
            </div>
          </div>

          {/* Session ID */}
          <div className="pt-3 border-t border-border/30 text-center">
            <div className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1">
              {t("analytics.sessionIdLabel")}
            </div>
            <code className="font-mono text-[10px] text-muted-foreground/70 select-all">
              {sessionStats.session_id}
            </code>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

SessionStatsView.displayName = "SessionStatsView";
