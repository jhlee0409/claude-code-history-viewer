import React from "react";
import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderUsageStats } from "../../../types";
import { getProviderId, getProviderLabel } from "../../../utils/providers";

interface ProviderDistributionChartProps {
  providers: ProviderUsageStats[];
}

const PROVIDER_COLORS: Record<string, string> = {
  claude: "var(--metric-amber)",
  codex: "var(--metric-green)",
  opencode: "var(--metric-blue)",
};

export const ProviderDistributionChart: React.FC<ProviderDistributionChartProps> = ({
  providers,
}) => {
  const { t } = useTranslation();
  const sortedProviders = [...providers].sort((a, b) => b.tokens - a.tokens);
  const totalTokens = sortedProviders.reduce((sum, provider) => sum + provider.tokens, 0);
  const maxTokens = Math.max(...sortedProviders.map((provider) => provider.tokens), 1);

  if (sortedProviders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Server className="w-10 h-10 opacity-20" />
        <p className="text-[10px] uppercase tracking-wider mt-3">{t("analytics.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedProviders.map((provider) => {
        const normalizedId = getProviderId(provider.provider_id);
        const color = PROVIDER_COLORS[normalizedId] ?? "var(--metric-purple)";
        const percentage = totalTokens > 0 ? (provider.tokens / totalTokens) * 100 : 0;
        const barWidth = (provider.tokens / maxTokens) * 100;

        return (
          <div
            key={provider.provider_id}
            className={cn(
              "flex items-center gap-3 p-2.5 rounded-md",
              "transition-colors duration-200",
              "hover:bg-muted/30"
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] font-medium text-foreground/90 truncate pr-2">
                  {getProviderLabel((key, fallback) => t(key, fallback), provider.provider_id)}
                </span>
                <span className="font-mono text-[11px] font-semibold tabular-nums shrink-0 text-foreground">
                  {provider.tokens.toLocaleString()}
                </span>
              </div>

              <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: color,
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>

            <div className="w-28 text-right shrink-0">
              <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {percentage.toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t(
                  "analytics.providerDistributionMeta",
                  "{{sessions}} sessions · {{projects}} projects",
                  {
                    sessions: provider.sessions,
                    projects: provider.projects,
                  }
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

ProviderDistributionChart.displayName = "ProviderDistributionChart";
