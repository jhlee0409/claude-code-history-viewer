/**
 * GlobalStatsView Component
 *
 * Displays global statistics across all projects.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Activity, MessageCircle, Clock, Wrench, Cpu, Layers, BarChart3 } from "lucide-react";
import type { GlobalStatsSummary } from "../../../types";
import { formatDuration } from "../../../utils/time";
import { cn } from "@/lib/utils";
import {
  MetricCard,
  SectionCard,
  ActivityHeatmapComponent,
  ToolUsageChart,
} from "../components";
import { formatNumber, calculateModelMetrics, getRankMedal, hasMedal } from "../utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

interface GlobalStatsViewProps {
  globalSummary: GlobalStatsSummary;
}

export const GlobalStatsView: React.FC<GlobalStatsViewProps> = ({ globalSummary }) => {
  const { t } = useTranslation();
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
          <SectionCard title={t("analytics.modelDistribution")} icon={Cpu} colorVariant="blue">
            <div className="space-y-3">
              {globalSummary.model_distribution.map((model) => {
                const { percentage, formattedPrice, formattedTokens } = calculateModelMetrics(
                  model.model_name,
                  model.token_count,
                  model.input_tokens,
                  model.output_tokens,
                  model.cache_creation_tokens,
                  model.cache_read_tokens,
                  globalSummary.total_tokens
                );

                return (
                  <div key={model.model_name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-medium text-foreground truncate max-w-[60%]">
                        {model.model_name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {formattedPrice}
                        </span>
                        <span className="font-mono text-[12px] font-semibold text-foreground">
                          {formattedTokens}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${percentage}%`,
                          background:
                            "linear-gradient(90deg, var(--metric-purple), var(--metric-blue))",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        <SectionCard title={t("analytics.mostUsedToolsTitle")} icon={Wrench} colorVariant="amber">
          <ToolUsageChart tools={globalSummary.most_used_tools} />
        </SectionCard>
      </div>

      {/* Heatmap & Top Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title={t("analytics.activityHeatmapTitle")} icon={Layers} colorVariant="green">
          {globalSummary.activity_heatmap.length > 0 ? (
            <ActivityHeatmapComponent data={globalSummary.activity_heatmap} />
          ) : (
            <div className="text-center py-8 text-muted-foreground text-[12px]">
              {t("analytics.No activity data available")}
            </div>
          )}
        </SectionCard>

        {globalSummary.top_projects.length > 0 && (
          <SectionCard title={t("analytics.topProjects")} icon={BarChart3} colorVariant="purple">
            <div className="space-y-2">
              {globalSummary.top_projects.slice(0, 8).map((project, index) => {
                const medal = getRankMedal(index);
                return (
                  <div
                    key={project.project_name}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-lg",
                      "bg-muted/30 hover:bg-muted/50 transition-colors"
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold",
                          hasMedal(index) ? "text-base" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {medal ?? index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-[12px] font-medium text-foreground truncate text-left"
                            >
                              {project.project_name}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {project.project_name}
                          </TooltipContent>
                        </Tooltip>
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

GlobalStatsView.displayName = "GlobalStatsView";
