/**
 * GlobalStatsView Component
 *
 * Displays global statistics across all projects.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  MessageCircle,
  Clock,
  Wrench,
  Cpu,
  Layers,
  BarChart3,
  Server,
  Sparkles,
  Bot,
} from "lucide-react";
import type { GlobalStatsSummary, MetricMode } from "../../../types";
import { formatDuration } from "../../../utils/time";
import { cn } from "@/lib/utils";
import {
  MetricCard,
  SectionCard,
  BillingBreakdownCard,
  ActivityHeatmapComponent,
  ToolUsageChart,
  ProviderDistributionChart,
} from "../components";
import {
  formatNumber,
  formatCurrency,
  calculateModelMetrics,
  calculateGlobalCostSummary,
  getRankMedal,
  hasMedal,
} from "../utils";
import { calculateConversationBreakdownCoverage } from "../../../utils/providers";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

interface GlobalStatsViewProps {
  globalSummary: GlobalStatsSummary;
  globalConversationSummary: GlobalStatsSummary | null;
  metricMode?: MetricMode;
}

export const GlobalStatsView: React.FC<GlobalStatsViewProps> = ({
  globalSummary,
  globalConversationSummary,
  metricMode = "tokens",
}) => {
  const { t } = useTranslation();
  const totalSessionTime = globalSummary.total_session_duration_minutes;
  const costSummary = useMemo(
    () =>
      calculateGlobalCostSummary(
        globalSummary.model_distribution,
        globalSummary.total_tokens
      ),
    [globalSummary.model_distribution, globalSummary.total_tokens]
  );
  const totalEstimatedCost = costSummary.totalEstimatedCost;
  const conversationCostSummary = useMemo(() => {
    if (!globalConversationSummary) {
      return null;
    }
    return calculateGlobalCostSummary(
      globalConversationSummary.model_distribution,
      globalConversationSummary.total_tokens
    );
  }, [globalConversationSummary]);

  const billingTokens = globalSummary.total_tokens;
  const billingCost = costSummary.pricedModels > 0 ? totalEstimatedCost : null;
  const conversationBreakdownCoverage = useMemo(
    () =>
      calculateConversationBreakdownCoverage(globalSummary.provider_distribution),
    [globalSummary.provider_distribution]
  );

  const lastUpdated = useMemo(() => {
    const raw = globalSummary.date_range.last_message;
    if (!raw) {
      return t("analytics.lastUpdatedUnknown", "Unknown");
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return t("analytics.lastUpdatedUnknown", "Unknown");
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed);
  }, [globalSummary.date_range.last_message, t]);

  return (
    <div className="flex-1 p-3 md:p-6 overflow-auto bg-background space-y-4 md:space-y-6 animate-stagger">
      <p className="text-px11 text-muted-foreground">
        {t(
          "analytics.providerScopeProjectTree",
          "Provider scope follows Project Tree provider tabs."
        )}
      </p>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <MetricCard
          icon={Activity}
          label={t("analytics.totalTokens")}
          value={formatNumber(globalSummary.total_tokens)}
          subValue={
            t("analytics.estimatedCostValue", "Estimated Cost: {{cost}}", {
              cost: billingCost == null
                ? t("common.dash", "—")
                : formatCurrency(totalEstimatedCost),
            })
          }
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

      <BillingBreakdownCard
        billingTokens={billingTokens}
        conversationTokens={globalConversationSummary?.total_tokens ?? null}
        billingCost={billingCost}
        conversationCost={
          conversationCostSummary && conversationCostSummary.pricedModels > 0
            ? conversationCostSummary.totalEstimatedCost
            : null
        }
        showProviderLimitHelp={conversationBreakdownCoverage.hasLimitedProviders}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 text-px11">
          {costSummary.exactModels > 0 && costSummary.estimatedModels > 0
            ? t("analytics.mixedCostLabel", "Exact + estimated")
            : costSummary.exactModels > 0
              ? t("analytics.exactCostLabel", "Exact source cost")
              : t("analytics.estimatedLabel", "Estimated")}
        </span>
        <span className="px-2 py-1 rounded-md bg-muted/40 text-muted-foreground text-px11">
          {t("analytics.pricingCoverage", "Pricing coverage")}: {costSummary.coveragePercent.toFixed(1)}%
        </span>
        {costSummary.unpricedModels > 0 && (
          <span className="px-2 py-1 rounded-md bg-red-500/10 text-red-700 dark:text-red-300 text-px11">
            {t("analytics.unpricedModels", "Unpriced models")}: {costSummary.unpricedModels}
          </span>
        )}
        <span className="px-2 py-1 rounded-md bg-muted/40 text-muted-foreground text-px11">
          {t("analytics.lastUpdated", "Last updated")}: {lastUpdated}
        </span>
      </div>

      {/* Model Distribution & Tool Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {globalSummary.provider_distribution.length > 0 && (
          <SectionCard
            title={t("analytics.providerDistribution", "Provider Distribution")}
            icon={Server}
            colorVariant="green"
          >
            <ProviderDistributionChart providers={globalSummary.provider_distribution} />
          </SectionCard>
        )}

        {globalSummary.model_distribution.length > 0 && (
          <SectionCard title={t("analytics.modelDistribution")} icon={Cpu} colorVariant="blue">
            <div className="space-y-3">
              {globalSummary.model_distribution.map((model) => {
                const { percentage, formattedPrice, formattedTokens, pricingStatus } = calculateModelMetrics(
                  model.model_name,
                  model.token_count,
                  model.input_tokens,
                  model.output_tokens,
                  model.cache_creation_tokens,
                  model.cache_read_tokens,
                  globalSummary.total_tokens,
                  {
                    providerId: model.provider_id,
                    serviceTier: model.service_tier,
                    sourceCostUSD: model.cost_usd,
                    reasoningTokens: model.reasoning_tokens,
                    contextBreakdown: model.context_breakdown,
                  },
                );
                const modelKey = `${model.provider_id ?? "unknown"}:${model.model_name}:${model.service_tier ?? "standard"}`;

                return (
                  <div key={modelKey}>
                    <div className="flex items-center justify-between mb-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="block max-w-[60%] text-px12 font-medium text-foreground truncate text-left cursor-default"
                          >
                            <span className="flex items-center gap-1.5">
                              <span>{model.model_name}</span>
                              <span className="text-px10 text-muted-foreground/70">
                                [{model.provider_id ?? t("analytics.unknownProvider", "unknown provider")}]
                              </span>
                              {model.service_tier && model.service_tier !== "standard" && (
                                <span className="text-px10 text-muted-foreground/70">
                                  [{model.service_tier}]
                                </span>
                              )}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {model.provider_id ? `${model.provider_id} / ` : ""}{model.model_name}
                          {model.service_tier ? ` (${model.service_tier})` : ""}
                        </TooltipContent>
                      </Tooltip>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-px12 text-muted-foreground">
                          {metricMode === "cost_estimated" ? formattedPrice : formattedTokens}
                        </span>
                        <span className="font-mono text-px12 font-semibold text-foreground">
                          {metricMode === "cost_estimated"
                            ? formattedTokens
                            : formattedPrice}
                        </span>
                        <span
                          className={cn(
                            "text-px10 uppercase tracking-wide",
                            pricingStatus === "exact"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : pricingStatus === "estimated"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-600 dark:text-red-400",
                          )}
                        >
                          {pricingStatus === "exact"
                            ? t("analytics.costExact", "exact")
                            : pricingStatus === "estimated"
                              ? t("analytics.costEstimatedShort", "est.")
                              : t("analytics.costUnavailable", "n/a")}
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

        <SectionCard
          title={t("analytics.mostUsedToolsTitle")}
          icon={Wrench}
          colorVariant="amber"
        >
          <ToolUsageChart tools={globalSummary.most_used_tools} />
        </SectionCard>
      </div>

      {/* Skill / Subagent usage (#321) — only shown when there is data */}
      {(globalSummary.most_used_skills.length > 0 ||
        globalSummary.most_used_subagents.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {globalSummary.most_used_skills.length > 0 && (
            <SectionCard title={t("analytics.mostUsedSkillsTitle")} icon={Sparkles} colorVariant="pink">
              <ToolUsageChart tools={globalSummary.most_used_skills} />
            </SectionCard>
          )}
          {globalSummary.most_used_subagents.length > 0 && (
            <SectionCard title={t("analytics.mostUsedSubagentsTitle")} icon={Bot} colorVariant="teal">
              <ToolUsageChart tools={globalSummary.most_used_subagents} />
            </SectionCard>
          )}
        </div>
      )}

      {/* Heatmap & Top Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title={t("analytics.activityHeatmapTitle")} icon={Layers} colorVariant="green">
          {globalSummary.daily_stats.length > 0 ? (
            <ActivityHeatmapComponent data={globalSummary.daily_stats} />
          ) : (
            <div className="text-center py-8 text-muted-foreground text-px12">
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
                          "w-6 h-6 rounded-md flex items-center justify-center text-px12 font-bold",
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
                              className="block w-full text-px12 font-medium text-foreground truncate text-left cursor-default"
                            >
                              {project.project_name}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {project.project_name}
                          </TooltipContent>
                        </Tooltip>
                        <p className="text-px12 text-muted-foreground">
                          {t(
                            "analytics.topProjectMeta",
                            "{{sessions}} sessions • {{messages}} msgs",
                            {
                              sessions: project.sessions,
                              messages: project.messages,
                            }
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-px12 font-bold text-foreground">
                        {formatNumber(project.tokens)}
                      </p>
                      <p className="text-px12 text-muted-foreground">{t("analytics.tokens")}</p>
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
