/**
 * TokenDistributionChart Component
 *
 * Clean donut chart with legend list.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, Zap, Database, Eye } from "lucide-react";
import { Tooltip, TooltipTrigger } from "../../ui/tooltip";
import { ChartTooltip } from "../../ui/chart-tooltip";
import type { TokenDistribution } from "../types";
import { formatNumber } from "../utils";
import { cn } from "@/lib/utils";

interface TokenDistributionChartProps {
  distribution: TokenDistribution;
  total: number;
}

export const TokenDistributionChart: React.FC<TokenDistributionChartProps> = ({
  distribution,
  total,
}) => {
  const { t } = useTranslation();

  const items = useMemo(
    () => [
      { label: t("analytics.input"), value: distribution.input, color: "var(--metric-green)", icon: TrendingUp },
      { label: t("analytics.output"), value: distribution.output, color: "var(--metric-purple)", icon: Zap },
      { label: t("analytics.cacheCreation"), value: distribution.cache_creation, color: "var(--metric-blue)", icon: Database },
      { label: t("analytics.cacheRead"), value: distribution.cache_read, color: "var(--metric-amber)", icon: Eye },
    ],
    [t, distribution]
  );

  const safeTotal = Math.max(total, 1);

  // Calculate SVG arc paths for donut chart
  const { arcs, sortedItems } = useMemo(() => {
    const sorted = [...items].filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    const radius = 80;
    const cx = 100;
    const cy = 100;
    let startAngle = -90;

    const arcPaths = sorted.map((item) => {
      const percentage = item.value / safeTotal;
      const angle = percentage * 360;
      const endAngle = startAngle + angle;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;
      const x1 = cx + radius * Math.cos(startRad);
      const y1 = cy + radius * Math.sin(startRad);
      const x2 = cx + radius * Math.cos(endRad);
      const y2 = cy + radius * Math.sin(endRad);
      const largeArc = angle > 180 ? 1 : 0;

      const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
      startAngle = endAngle;

      return { ...item, path, percentage };
    });

    return { arcs: arcPaths, sortedItems: sorted };
  }, [items, safeTotal]);

  return (
    <div className="space-y-5">
      {/* Donut Chart */}
      <div className="relative flex items-center justify-center">
        <svg viewBox="0 0 200 200" className="w-44 h-44 -rotate-90">
          {/* Background ring */}
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="20"
            opacity="0.15"
          />

          {/* Data arcs */}
          {arcs.map((arc) => (
            <Tooltip key={arc.label}>
              <TooltipTrigger asChild>
                <path
                  d={arc.path}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="20"
                  strokeLinecap="butt"
                  className="cursor-pointer transition-opacity duration-200 hover:opacity-70"
                />
              </TooltipTrigger>
              <ChartTooltip
                title={arc.label}
                side="right"
                rows={[
                  { label: t("analytics.tooltip.tokens"), value: `${formatNumber(arc.value)}`, color: arc.color },
                  { label: t("analytics.tooltip.share"), value: `${(arc.percentage * 100).toFixed(1)}%` },
                ]}
              />
            </Tooltip>
          ))}
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-mono text-2xl font-bold text-foreground tabular-nums">
            {formatNumber(total)}
          </div>
          <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
            {t("analytics.totalTokenUsage")}
          </div>
        </div>
      </div>

      {/* Legend List */}
      <div className="space-y-2">
        {sortedItems.map((item) => {
          const Icon = item.icon;
          const percentage = (item.value / safeTotal) * 100;

          return (
            <div
              key={item.label}
              className={cn(
                "flex items-center gap-3 p-2.5 rounded-md",
                "transition-colors duration-200 hover:bg-muted/30"
              )}
            >
              {/* Icon */}
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                style={{
                  background: `color-mix(in oklch, ${item.color} 15%, transparent)`,
                }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
              </div>

              {/* Label & Bar */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[11px] font-medium text-foreground/80 truncate">
                    {item.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground ml-2 tabular-nums">
                    {percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: item.color,
                      opacity: 0.8,
                    }}
                  />
                </div>
              </div>

              {/* Value */}
              <div
                className="font-mono text-sm font-semibold text-right shrink-0 tabular-nums"
                style={{ color: item.color }}
              >
                {formatNumber(item.value)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

TokenDistributionChart.displayName = "TokenDistributionChart";
