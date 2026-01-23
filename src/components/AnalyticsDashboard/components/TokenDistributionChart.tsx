/**
 * TokenDistributionChart Component
 *
 * Displays token distribution by type (input, output, cache).
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, Zap, Database, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import type { TokenDistribution } from "../types";
import { formatNumber } from "../utils";

interface TokenDistributionChartProps {
  distribution: TokenDistribution;
  total: number;
}

export const TokenDistributionChart: React.FC<TokenDistributionChartProps> = ({
  distribution,
  total,
}) => {
  const { t } = useTranslation("components");

  const items = [
    { label: t("analytics.input"), value: distribution.input, color: "var(--metric-green)", icon: TrendingUp },
    { label: t("analytics.output"), value: distribution.output, color: "var(--metric-purple)", icon: Zap },
    { label: t("analytics.cacheCreation"), value: distribution.cache_creation, color: "var(--metric-blue)", icon: Database },
    { label: t("analytics.cacheRead"), value: distribution.cache_read, color: "var(--metric-amber)", icon: Eye },
  ];

  // Guard against division by zero
  const safeTotal = Math.max(total, 1);

  return (
    <div className="space-y-4">
      {/* Stacked bar */}
      <div className="h-4 flex rounded-full overflow-hidden bg-muted/30">
        {items.map((item, i) => {
          const width = (item.value / safeTotal) * 100;
          if (width < 0.5) return null;
          return (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <div
                  className="h-full transition-all hover:brightness-110 cursor-pointer"
                  style={{
                    width: `${width}%`,
                    background: item.color,
                    marginLeft: i > 0 ? "1px" : 0,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent className="font-mono text-xs">
                <div>
                  {item.label}: {formatNumber(item.value)} (
                  {((item.value / safeTotal) * 100).toFixed(1)}%)
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Legend items */}
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          const percentage = (item.value / safeTotal) * 100;
          return (
            <div
              key={item.label}
              className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: `${item.color}20` }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                </div>
                <span className="text-[12px] font-medium text-foreground/70">{item.label}</span>
              </div>
              <div className="text-right">
                <div className="font-mono text-[12px] font-semibold" style={{ color: item.color }}>
                  {formatNumber(item.value)}
                </div>
                <div className="font-mono text-[12px] text-muted-foreground">
                  {percentage.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="pt-3 border-t border-border/50 text-center">
        <div className="font-mono text-2xl font-bold text-foreground tracking-tight">
          {formatNumber(total)}
        </div>
        <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          {t("analytics.totalTokenUsage")}
        </div>
      </div>
    </div>
  );
};

TokenDistributionChart.displayName = "TokenDistributionChart";
