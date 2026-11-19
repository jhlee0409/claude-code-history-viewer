import React from "react";
import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { cn } from "@/lib/utils";
import type { ProviderUsageStats } from "../../../types";
import { getProviderId, getProviderLabel } from "../../../utils/providers";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

interface ProviderDistributionChartProps {
  providers: ProviderUsageStats[];
}

const PROVIDER_COLORS: Record<string, string> = {
  aider: "var(--metric-red)",
  claude: "var(--metric-amber)",
  cline: "var(--metric-teal)",
  codex: "var(--metric-green)",
  cursor: "#f54e00",
  gemini: "var(--metric-purple)",
  grok: "var(--metric-red)",
  opencode: "var(--metric-blue)",
};

export const ProviderDistributionChart: React.FC<ProviderDistributionChartProps> = ({
  providers,
}) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const sortedProviders = [...providers].sort(
    (a, b) => b.tokens - a.tokens || b.sessions - a.sessions
  );
  const totalTokens = sortedProviders.reduce((sum, provider) => sum + provider.tokens, 0);
  const totalSessions = sortedProviders.reduce((sum, provider) => sum + provider.sessions, 0);
  const useSessionBars = totalTokens === 0;
  const totalBarValue = useSessionBars ? totalSessions : totalTokens;
  const maxBarValue = Math.max(
    ...(useSessionBars
      ? sortedProviders.map((provider) => provider.sessions)
      : sortedProviders.map((provider) => provider.tokens)),
    1
  );

  if (sortedProviders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Icon icon={Server} size={24} className="opacity-20" />
        <p className="text-caption uppercase tracking-wider mt-3">{t("analytics.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedProviders.map((provider) => {
        const normalizedId = getProviderId(provider.provider_id);
        const color = PROVIDER_COLORS[normalizedId] ?? "var(--metric-purple)";
        const barValue = useSessionBars ? provider.sessions : provider.tokens;
        const percentage = totalBarValue > 0 ? (barValue / totalBarValue) * 100 : 0;
        const barWidth = (barValue / maxBarValue) * 100;

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
                <span className="text-caption font-medium text-foreground/90 truncate pr-2">
                  {getProviderLabel((key, fallback) => t(key, fallback), provider.provider_id)}
                </span>
                <span className="font-mono text-caption font-semibold tabular-nums shrink-0 text-foreground">
                  <Num>{useSessionBars
                    ? fmt.count(provider.sessions)
                    : fmt.tokens(provider.tokens)}</Num>
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
              <div className="font-mono text-caption text-muted-foreground tabular-nums">
                <Num>{fmt.percent(percentage / 100)}</Num>
              </div>
              <div className="text-caption text-muted-foreground">
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
