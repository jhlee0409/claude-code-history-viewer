import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { calculateGlobalCostSummary, formatNumber, formatCurrency } from "../utils";
import type { SessionTokenStats, SubagentTokenStats } from "../../../types";

interface SubagentRollupCardProps {
  stats: SessionTokenStats;
  subagentStats: SubagentTokenStats;
  className?: string;
}

/**
 * Shows the usage of the sessions a session spawned, and the combined
 * main-thread + subagent totals.
 *
 * Providers that persist a subagent run as its own session row (OpenCode)
 * keep that billed usage out of the parent session, so without this roll-up
 * the token stats card understates the cost of the originating session.
 */
export const SubagentRollupCard: React.FC<SubagentRollupCardProps> = ({
  stats,
  subagentStats,
  className,
}) => {
  const { t } = useTranslation();

  const subagentCost = useMemo(
    () =>
      calculateGlobalCostSummary(
        subagentStats.model_distribution ?? [],
        subagentStats.total_tokens,
      ),
    [subagentStats],
  );

  const combinedCost = useMemo(
    () =>
      calculateGlobalCostSummary(
        [...(stats.model_distribution ?? []), ...(subagentStats.model_distribution ?? [])],
        stats.total_tokens + subagentStats.total_tokens,
      ),
    [stats, subagentStats],
  );

  const combinedTokens = stats.total_tokens + subagentStats.total_tokens;
  const subagentCostLabel =
    subagentCost.pricedModels > 0
      ? formatCurrency(subagentCost.totalEstimatedCost)
      : t("common.dash", "—");
  const combinedCostLabel =
    combinedCost.pricedModels > 0
      ? formatCurrency(combinedCost.totalEstimatedCost)
      : t("common.dash", "—");

  return (
    <SectionCard
      title={t("analytics.subagents", "Subagents")}
      icon={Users}
      colorVariant="purple"
      className={className}
    >
      <div className="space-y-3">
        <p className="text-px12 text-muted-foreground">
          {t(
            "analytics.subagentsHelp",
            "Delegated runs are stored as separate sessions and billed on top of the main thread.",
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-px11 text-muted-foreground">
              {t("analytics.subagents", "Subagents")}
            </p>
            <p className="font-mono text-px14 font-semibold text-foreground">
              {formatNumber(subagentStats.total_tokens)}
            </p>
            <p className="font-mono text-px11 text-muted-foreground">{subagentCostLabel}</p>
            <p className="text-px10 text-muted-foreground">
              {t("analytics.subagentSessions", { count: subagentStats.session_count })}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-px11 text-muted-foreground">
              {t("analytics.sessionTotalWithSubagents", "Session total (incl. subagents)")}
            </p>
            <p className="font-mono text-px14 font-semibold text-foreground">
              {formatNumber(combinedTokens)}
            </p>
            <p className="font-mono text-px11 text-muted-foreground">{combinedCostLabel}</p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
};

SubagentRollupCard.displayName = "SubagentRollupCard";
