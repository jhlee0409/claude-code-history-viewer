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
import { formatNumber, generateLast7DaysData, extractProjectGrowth } from "../utils";

interface ProjectStatsViewProps {
  projectSummary: ProjectStatsSummary | null;
}

export const ProjectStatsView: React.FC<ProjectStatsViewProps> = ({
  projectSummary,
}) => {
  const { t } = useTranslation();

  // Generate 7-day daily data using utility function
  const dailyData = useMemo(
    () => generateLast7DaysData(projectSummary?.daily_stats),
    [projectSummary?.daily_stats]
  );

  // 데이터가 없으면 항상 로딩 상태 표시 (뷰 전환 직후 isLoading이 false일 수 있음)
  if (!projectSummary) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <LoadingState
          isLoading={true}
          loadingMessage={t("analytics.loading")}
          spinnerSize="lg"
          withSparkle={true}
        />
      </div>
    );
  }

  // Calculate growth metrics using utility function
  const { tokenGrowth, messageGrowth } = extractProjectGrowth(projectSummary);

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
