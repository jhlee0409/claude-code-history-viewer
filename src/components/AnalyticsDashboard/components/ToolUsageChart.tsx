/**
 * ToolUsageChart Component
 *
 * Displays horizontal bar chart of tool usage statistics.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import type { ToolUsageStats } from "../../../types";
import { getToolDisplayName } from "../utils";

interface ToolUsageChartProps {
  tools: ToolUsageStats[];
}

// Industrial color palette using CSS variables
const TOOL_COLORS = [
  { bg: "var(--metric-purple)", glow: "var(--glow-purple)" },
  { bg: "var(--metric-green)", glow: "var(--glow-green)" },
  { bg: "var(--metric-blue)", glow: "var(--glow-blue)" },
  { bg: "var(--metric-amber)", glow: "var(--glow-amber)" },
  { bg: "var(--metric-pink)", glow: "var(--metric-pink)" },
  { bg: "var(--metric-teal)", glow: "var(--metric-teal)" },
];

export const ToolUsageChart: React.FC<ToolUsageChartProps> = ({ tools }) => {
  const { t } = useTranslation("components");
  const topTools = tools.slice(0, 6);
  const maxUsage = Math.max(...topTools.map((t) => t.usage_count), 1);
  const totalUsage = topTools.reduce((sum, t) => sum + t.usage_count, 0);

  if (topTools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Wrench className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-[12px]">{t("analytics.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {topTools.map((tool, index) => {
        const color = TOOL_COLORS[index % TOOL_COLORS.length]!;
        const percentage = totalUsage === 0 ? 0 : (tool.usage_count / totalUsage) * 100;
        const barWidth = (tool.usage_count / maxUsage) * 100;

        return (
          <div key={tool.tool_name} className="group">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: color.bg, boxShadow: `0 0 6px ${color.bg}` }}
                />
                <span className="text-[12px] font-medium text-foreground/80">
                  {getToolDisplayName(tool.tool_name, t)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[12px] font-semibold text-foreground">
                  {tool.usage_count.toLocaleString()}
                </span>
                <span className="font-mono text-[12px] text-muted-foreground w-12 text-right">
                  {percentage.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 group-hover:brightness-110"
                style={{
                  width: `${barWidth}%`,
                  background: color.bg,
                  boxShadow: `0 0 12px ${color.bg}`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

ToolUsageChart.displayName = "ToolUsageChart";
