/**
 * ToolUsageChart Component
 *
 * Clean ranked list with progress bars.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolUsageStats } from "../../../types";
import { getToolDisplayName } from "../utils";

interface ToolUsageChartProps {
  tools: ToolUsageStats[];
}

// Rotating color palette
const TOOL_COLORS = [
  "var(--metric-purple)",
  "var(--metric-green)",
  "var(--metric-blue)",
  "var(--metric-amber)",
  "var(--metric-pink)",
  "var(--metric-teal)",
];

export const ToolUsageChart: React.FC<ToolUsageChartProps> = ({ tools }) => {
  const { t } = useTranslation();
  const topTools = tools.slice(0, 6);
  const maxUsage = Math.max(...topTools.map((t) => t.usage_count), 1);
  const totalUsage = topTools.reduce((sum, t) => sum + t.usage_count, 0);

  if (topTools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Wrench className="w-10 h-10 opacity-20" />
        <p className="text-[10px] uppercase tracking-wider mt-3">{t("analytics.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {topTools.map((tool, index) => {
        const color = TOOL_COLORS[index % TOOL_COLORS.length]!;
        const percentage = totalUsage === 0 ? 0 : (tool.usage_count / totalUsage) * 100;
        const barWidth = (tool.usage_count / maxUsage) * 100;

        return (
          <div
            key={tool.tool_name}
            className={cn(
              "flex items-center gap-3 p-2.5 rounded-md",
              "transition-colors duration-200",
              "hover:bg-muted/30"
            )}
          >
            {/* Rank */}
            <div
              className="w-5 text-[10px] font-bold tabular-nums"
              style={{ color: index < 3 ? color : "var(--muted-foreground)" }}
            >
              {index + 1}
            </div>

            {/* Tool info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] font-medium text-foreground/90 truncate pr-2">
                  {getToolDisplayName(tool.tool_name, t)}
                </span>
                <span
                  className="font-mono text-[11px] font-semibold tabular-nums shrink-0"
                  style={{ color }}
                >
                  {tool.usage_count.toLocaleString()}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: color,
                    opacity: 0.8,
                  }}
                />
              </div>
            </div>

            {/* Percentage */}
            <div className="w-12 text-right shrink-0">
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {percentage.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}

      {/* Total footer */}
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-border/30">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
          Total Usage
        </span>
        <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
          {totalUsage.toLocaleString()}
        </span>
      </div>
    </div>
  );
};

ToolUsageChart.displayName = "ToolUsageChart";
