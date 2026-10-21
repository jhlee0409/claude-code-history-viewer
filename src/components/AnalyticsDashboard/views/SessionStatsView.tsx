/**
 * SessionStatsView Component
 *
 * Clean session analytics with performance metrics and timeline.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChartColumn, Clock, TrendingUp, TrendingDown, Zap, MessageSquare, Timer } from "lucide-react";
import type { SessionTokenStats, SessionComparison, ProviderId } from "../../../types";
import { SectionCard, TokenDistributionChart, BillingBreakdownCard } from "../components";
import {
  calculateGlobalCostSummary,
  calculateSessionMetrics,
  calculateSessionComparisonMetrics,
} from "../utils";
import { supportsConversationBreakdown } from "../../../utils/providers";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

interface SessionStatsViewProps {
  sessionStats: SessionTokenStats;
  conversationStats?: SessionTokenStats | null;
  sessionComparison: SessionComparison;
  totalProjectSessions?: number;
  providerId?: ProviderId;
}

export const SessionStatsView: React.FC<SessionStatsViewProps> = ({
  sessionStats,
  conversationStats,
  sessionComparison,
  totalProjectSessions = 1,
  providerId = "claude",
}) => {
  const { t } = useTranslation();
  const fmt = useFormat();

  // Memoized session metrics calculation
  const { avgTokensPerMessage, durationMinutes, distribution } = useMemo(
    () => calculateSessionMetrics(sessionStats),
    [sessionStats]
  );

  // Memoized comparison metrics calculation
  const { isAboveAverage, statusColor, percentileRatio } = useMemo(
    () => calculateSessionComparisonMetrics(sessionComparison, totalProjectSessions),
    [sessionComparison, totalProjectSessions]
  );
  const billingTokens = sessionStats.total_tokens;
  const billingCostSummary = useMemo(
    () =>
      calculateGlobalCostSummary(
        sessionStats.model_distribution ?? [],
        sessionStats.total_tokens,
      ),
    [sessionStats.model_distribution, sessionStats.total_tokens],
  );
  const conversationCostSummary = useMemo(() => {
    if (!conversationStats) return null;
    return calculateGlobalCostSummary(
      conversationStats.model_distribution ?? [],
      conversationStats.total_tokens,
    );
  }, [conversationStats]);

  return (
    <div className="space-y-6">
      {/* Performance Banner */}
      <div className="rounded-lg bg-card/80 backdrop-blur-sm border border-border/40 overflow-hidden">
        <div className="p-3 md:p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-caption font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {t("analytics.performanceInsights")}
              </h3>
              <div className="flex items-center gap-2">
                {isAboveAverage ? (
                  <TrendingUp className="w-4 h-4" style={{ color: statusColor }} />
                ) : (
                  <TrendingDown className="w-4 h-4" style={{ color: statusColor }} />
                )}
                <span className="text-title font-bold" style={{ color: statusColor }}>
                  {isAboveAverage ? t("analytics.aboveAverage") : t("analytics.belowAverage")}
                </span>
              </div>
            </div>

            {/* Rank badge */}
            <div
              className="px-3 py-2 rounded-md"
              style={{ background: `color-mix(in oklch, ${statusColor} 10%, transparent)` }}
            >
              <div className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
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
                <span className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.projectShare")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                <Num>{fmt.percent(sessionComparison.percentage_of_project_tokens / 100)}</Num>
              </div>
              <div className="text-caption text-muted-foreground font-mono mt-0.5">
                <Num>{fmt.tokens(sessionStats.total_tokens)}</Num> {t("analytics.tokens")}
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.tokensPerMessage")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                <Num>{fmt.tokens(avgTokensPerMessage)}</Num>
              </div>
              <div className="text-caption text-muted-foreground font-mono mt-0.5">
                {t("analytics.messageCountShort", "{{count}} msgs", {
                  count: sessionStats.message_count,
                })}
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Timer className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.sessionTime")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                {durationMinutes}
                <span className="text-title text-muted-foreground/50">
                  {t("analytics.minutesUnit")}
                </span>
              </div>
              <div className="text-caption text-muted-foreground font-mono mt-0.5">
                {t("analytics.rank", "Rank {{rank}}", {
                  rank: sessionComparison.rank_by_duration,
                })}
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                  {t("analytics.percentile", "Percentile")}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
                <Num>{fmt.percent(percentileRatio)}</Num>
              </div>
              <div className="text-caption text-muted-foreground font-mono mt-0.5">
                {t("analytics.sessionCount", "{{count}} sessions", {
                  count: totalProjectSessions,
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <BillingBreakdownCard
        billingTokens={billingTokens}
        conversationTokens={conversationStats != null ? conversationStats.total_tokens : null}
        billingCost={
          billingCostSummary.pricedModels > 0
            ? billingCostSummary.totalEstimatedCost
            : null
        }
        conversationCost={
          conversationCostSummary && conversationCostSummary.pricedModels > 0
            ? conversationCostSummary.totalEstimatedCost
            : null
        }
        showProviderLimitHelp={!supportsConversationBreakdown(providerId)}
      />

      {/* Token Distribution */}
      <SectionCard title={t("analytics.tokenAnalysis")} icon={ChartColumn} colorVariant="purple">
        <TokenDistributionChart distribution={distribution} total={sessionStats.total_tokens} />
      </SectionCard>

      {/* Session Timeline */}
      <SectionCard title={t("analytics.sessionTimeline")} icon={Clock} colorVariant="green">
        <div className="space-y-4">
          <div className="relative flex items-center justify-between">
            {/* Start */}
            <div className="text-center z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-metric-green mb-2 mx-auto" />
              <div className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.startTime")}
              </div>
              <div className="font-mono text-caption text-foreground mt-0.5">
                <Num>{fmt.dateTime(sessionStats.first_message_time)}</Num>
              </div>
            </div>

            {/* Connection line */}
            <div className="absolute left-6 right-6 top-1 h-px bg-gradient-to-r from-metric-green via-border to-metric-amber" />

            {/* Duration */}
            <div className="text-center z-10 px-3 py-1.5 bg-card rounded-md border border-border/40">
              <div className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.duration")}
              </div>
              <div className="font-mono text-title font-bold text-foreground">
                {durationMinutes}<span className="text-body text-muted-foreground/50">{t("analytics.minutesUnit")}</span>
              </div>
            </div>

            {/* End */}
            <div className="text-center z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-metric-amber mb-2 mx-auto" />
              <div className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
                {t("analytics.endTime")}
              </div>
              <div className="font-mono text-caption text-foreground mt-0.5">
                <Num>{fmt.dateTime(sessionStats.last_message_time)}</Num>
              </div>
            </div>
          </div>

          {/* Session ID */}
          <div className="pt-3 border-t border-border/30 text-center">
            <div className="text-caption font-medium text-muted-foreground/60 uppercase tracking-wider mb-1">
              {t("analytics.sessionIdLabel")}
            </div>
            <code className="font-mono text-caption text-muted-foreground/70 select-all">
              {sessionStats.session_id}
            </code>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

SessionStatsView.displayName = "SessionStatsView";
