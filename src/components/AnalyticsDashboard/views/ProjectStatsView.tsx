/**
 * ProjectStatsView Component
 *
 * Displays project-level analytics and statistics.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Activity, Clock, Wrench, Layers, Cpu, TrendingUp, Database } from "lucide-react";
import { LoadingState } from "@/components/ui/loading";
import type { ProjectStatsSummary } from "../../../types";
import { formatDuration } from "../../../utils/time";
import {
  MetricCard,
  SectionCard,
  ActivityHeatmapComponent,
  ToolUsageChart,
  DailyTrendChart,
  TokenDistributionChart,
} from "../components";
import { calculateGrowthRate, formatNumber } from "../utils";
import type { DailyStatData } from "../types";

interface ProjectStatsViewProps {
  projectSummary: ProjectStatsSummary | null;
  isLoading: boolean;
}

export const ProjectStatsView: React.FC<ProjectStatsViewProps> = ({
  projectSummary,
  isLoading,
}) => {
  const { t } = useTranslation();

  // Generate 7-day daily data
  const dailyData = useMemo((): DailyStatData[] => {
    if (!projectSummary?.daily_stats) return [];

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return date.toISOString().split("T")[0];
    });

    return last7Days
      .filter((date): date is string => date !== undefined)
      .map((date) => {
        const dayStats = projectSummary?.daily_stats.find((stat) => stat.date === date);

        return {
          date,
          total_tokens: dayStats?.total_tokens || 0,
          message_count: dayStats?.message_count || 0,
          session_count: dayStats?.session_count || 0,
          active_hours: dayStats?.active_hours || 0,
        };
      });
  }, [projectSummary?.daily_stats]);

  if (!projectSummary) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <LoadingState
            isLoading={true}
            loadingMessage={t("analytics.loading")}
            spinnerSize="lg"
            withSparkle={true}
          />
        </div>
      );
    }
    return null;
  }

  const lastDayStats = projectSummary.daily_stats[projectSummary.daily_stats.length - 1];
  const prevDayStats = projectSummary.daily_stats[projectSummary.daily_stats.length - 2];
  const tokenGrowth =
    lastDayStats && prevDayStats
      ? calculateGrowthRate(lastDayStats.total_tokens, prevDayStats.total_tokens)
      : 0;
  const messageGrowth =
    lastDayStats && prevDayStats
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
        <SectionCard title={t("analytics.activityHeatmapTitle")} icon={Layers} colorVariant="green">
          {projectSummary.activity_heatmap.length > 0 ? (
            <ActivityHeatmapComponent data={projectSummary.activity_heatmap} />
          ) : (
            <div className="text-center py-8 text-muted-foreground text-[12px]">
              {t("analytics.No activity data available")}
            </div>
          )}
        </SectionCard>

        <SectionCard title={t("analytics.mostUsedToolsTitle")} icon={Cpu} colorVariant="purple">
          <ToolUsageChart tools={projectSummary.most_used_tools} />
        </SectionCard>
      </div>

      {/* Daily Trend Chart */}
      {projectSummary.daily_stats.length > 0 && (
        <SectionCard title={t("analytics.recentActivityTrend")} icon={TrendingUp} colorVariant="blue">
          <DailyTrendChart dailyData={dailyData} />
        </SectionCard>
      )}

      {/* Token Distribution */}
      <SectionCard title={t("analytics.tokenTypeDistribution")} icon={Database} colorVariant="amber">
        <TokenDistributionChart
          distribution={projectSummary.token_distribution}
          total={projectSummary.total_tokens}
        />
      </SectionCard>
    </div>
  );
};

ProjectStatsView.displayName = "ProjectStatsView";
