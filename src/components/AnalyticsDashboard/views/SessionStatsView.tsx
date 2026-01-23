/**
 * SessionStatsView Component
 *
 * Displays session-level analytics and comparison.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Clock } from "lucide-react";
import type { SessionTokenStats, SessionComparison } from "../../../types";
import { formatTime } from "../../../utils/time";
import { cn } from "@/lib/utils";
import { SectionCard, TokenDistributionChart } from "../components";
import { formatNumber } from "../utils";

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

  const avgTokensPerMessage =
    sessionStats.message_count > 0
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
                  percent: (
                    (sessionComparison.rank_by_tokens / totalProjectSessions) *
                    100
                  ).toFixed(0),
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
                {durationMinutes}
                <span className="text-lg text-muted-foreground">m</span>
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
      <SectionCard title={t("analytics.tokenAnalysis")} icon={BarChart3} colorVariant="purple">
        <TokenDistributionChart distribution={distribution} total={sessionStats.total_tokens} />
      </SectionCard>

      {/* Session Timeline */}
      <SectionCard title={t("analytics.sessionTimeline")} icon={Clock} colorVariant="green">
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
                {durationMinutes}
                {t("analytics.minutesUnit")}
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

SessionStatsView.displayName = "SessionStatsView";
