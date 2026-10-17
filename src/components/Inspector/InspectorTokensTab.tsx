/**
 * The inspector's Tokens tab: the open session's token usage, laid out for
 * a narrow column (200-400px).
 *
 * The same numbers the token stats screen shows for the current session,
 * from the same session load and the same calculations (formatting, cost
 * estimate, billing split), but not its cards: those are built for a wide
 * grid and wrap their labels one character per line at inspector widths.
 * Here every metric is one row - label on the left (it may wrap, but only
 * between words: `break-keep`, so Korean, Japanese and Chinese words stay
 * whole), value on the right (never wraps).
 *
 * Owned by the session (`useSessionTokenStats`): another session's totals
 * never show; until this session's arrive it shows its loading state, and
 * its own failure is its error state with a retry.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Database, Eye, TrendingUp, Zap, type LucideIcon } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { LoadingState } from "@/components/ui/loading";
import { calculateGlobalCostSummary } from "@/components/AnalyticsDashboard/utils";
import { formatCurrency, formatNumber } from "@/components/AnalyticsDashboard/utils/calculations";
import { supportsConversationBreakdown } from "@/utils/providers";
import { formatDurationCompact } from "@/utils/time";
import type { SessionTokenStats } from "@/types";
import { useSessionTokenStats } from "./useSessionTokenStats";

const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

const estimatedCost = (stats: SessionTokenStats | null): number | null => {
  if (!stats) return null;
  const summary = calculateGlobalCostSummary(stats.model_distribution ?? [], stats.total_tokens);
  return summary.pricedModels > 0 ? summary.totalEstimatedCost : null;
};

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section aria-labelledby={id} className="space-y-1.5">
    <h3 id={id} className="text-caption font-medium text-muted-foreground break-keep">
      {title}
    </h3>
    {children}
  </section>
);

/** One metric: label left (wraps between words only), value right (never wraps). */
const MetricRow = ({
  label,
  icon: Glyph,
  color,
  value,
  detail,
  title,
}: {
  label: ReactNode;
  icon?: LucideIcon;
  color?: string;
  value: string;
  /** Muted text after the value (a share, a cost). */
  detail?: string;
  title?: string;
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="flex min-w-0 items-baseline gap-1.5 text-list text-foreground break-keep" title={title}>
      {Glyph && <Glyph className="w-3.5 h-3.5 shrink-0 self-center" style={{ color }} aria-hidden="true" />}
      {label}
    </dt>
    <dd className="shrink-0 whitespace-nowrap font-mono text-list tabular-nums">
      <span style={color ? { color } : undefined} className={color ? undefined : "text-foreground"}>
        {value}
      </span>
      {detail !== undefined && <span className="ml-1.5 text-caption text-muted-foreground">{detail}</span>}
    </dd>
  </div>
);

export const InspectorTokensTab = () => {
  const { t } = useTranslation();
  const { stats, conversationStats, isLoading, error, retry } = useSessionTokenStats();
  const providerId = useAppStore(
    (s) => s.selectedSession?.provider ?? s.selectedProject?.provider ?? "claude",
  );

  const billingCost = useMemo(() => estimatedCost(stats), [stats]);
  const conversationCost = useMemo(() => estimatedCost(conversationStats), [conversationStats]);
  const models = useMemo(
    () =>
      [...(stats?.model_distribution ?? [])]
        .filter((model) => model.token_count > 0)
        .sort((a, b) => b.token_count - a.token_count),
    [stats],
  );

  const body = (() => {
    if (!stats) return null;
    const total = stats.total_tokens;
    const durationMinutes =
      (new Date(stats.last_message_time).getTime() - new Date(stats.first_message_time).getTime()) / 60_000;
    const breakdown = [
      { key: "input", label: t("analytics.inputTokens"), value: stats.total_input_tokens, icon: TrendingUp, color: "var(--metric-green)" },
      { key: "output", label: t("analytics.outputTokens"), value: stats.total_output_tokens, icon: Zap, color: "var(--metric-purple)" },
      { key: "cacheCreation", label: t("analytics.cacheCreation"), value: stats.total_cache_creation_tokens, icon: Database, color: "var(--metric-blue)" },
      { key: "cacheRead", label: t("analytics.cacheRead"), value: stats.total_cache_read_tokens, icon: Eye, color: "var(--metric-amber)" },
      { key: "reasoning", label: t("analytics.reasoning", "Reasoning"), value: stats.total_reasoning_tokens, icon: Brain, color: "var(--metric-pink)" },
    ].filter((row) => row.value > 0);
    const conversationTokens = conversationStats?.total_tokens ?? null;
    const costText = (cost: number | null) => (cost === null ? undefined : formatCurrency(cost));

    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        <section aria-label={t("analytics.totalTokens")}>
          <p className="whitespace-nowrap font-mono text-title font-semibold tabular-nums text-foreground">
            {formatNumber(total)}
            <span className="ml-1 font-sans text-caption font-normal text-muted-foreground">{t("analytics.tokens")}</span>
          </p>
          <p className="flex flex-wrap gap-x-2 text-caption text-muted-foreground">
            <span className="whitespace-nowrap">
              <span className="font-mono tabular-nums">{stats.message_count.toLocaleString()}</span>{" "}
              {t("analytics.messages")}
            </span>
            {Number.isFinite(durationMinutes) && durationMinutes >= 0 && (
              <span className="whitespace-nowrap">{formatDurationCompact(durationMinutes)}</span>
            )}
          </p>
        </section>

        {breakdown.length > 0 && (
          <Section id="inspector-tokens-breakdown" title={t("common.inspector.tokens.breakdown")}>
            <dl className="space-y-1">
              {breakdown.map((row) => (
                <MetricRow
                  key={row.key}
                  label={row.label}
                  icon={row.icon}
                  color={row.color}
                  value={formatNumber(row.value)}
                  detail={`${percent(row.value, total)}%`}
                />
              ))}
            </dl>
          </Section>
        )}

        {models.length > 0 && (
          <Section id="inspector-tokens-models" title={t("common.inspector.tokens.byModel")}>
            <dl className="space-y-1">
              {models.map((model) => (
                <MetricRow
                  key={`${model.model_name}-${model.service_tier ?? ""}`}
                  label={<span className="min-w-0 truncate font-mono">{model.model_name}</span>}
                  title={model.model_name}
                  value={formatNumber(model.token_count)}
                  detail={`${percent(model.token_count, total)}%`}
                />
              ))}
            </dl>
          </Section>
        )}

        <Section id="inspector-tokens-billing" title={t("analytics.billingBreakdown", "Billing Breakdown")}>
          <dl className="space-y-1">
            <MetricRow
              label={t("analytics.billingTotal", "Billing Total")}
              value={formatNumber(total)}
              detail={costText(billingCost)}
            />
            {conversationTokens !== null && (
              <>
                <MetricRow
                  label={t("analytics.conversationOnly", "Conversation Only")}
                  value={formatNumber(conversationTokens)}
                  detail={costText(conversationCost)}
                />
                <MetricRow
                  label={t("analytics.nonConversation", "Non-conversation")}
                  value={formatNumber(Math.max(0, total - conversationTokens))}
                  detail={
                    billingCost === null
                      ? undefined
                      : formatCurrency(Math.max(0, billingCost - (conversationCost ?? 0)))
                  }
                />
              </>
            )}
          </dl>
          {!supportsConversationBreakdown(providerId) && (
            <p className="text-caption text-muted-foreground break-keep">
              {t(
                "analytics.billingBreakdownProviderLimitHelp",
                "For some providers, conversation-only and billing totals can match because sidechain metadata is unavailable.",
              )}
            </p>
          )}
        </Section>
      </div>
    );
  })();

  return (
    <LoadingState
      // Words stay whole (keep-all); only a word wider than the column
      // breaks, at its edge (break-word).
      className="flex min-h-0 flex-1 flex-col break-keep break-words"
      isLoading={isLoading}
      error={error}
      errorTitle={t("common.inspector.tokens.error")}
      onRetry={retry}
      retryLabel={t("common.retry")}
      loadingMessage={t("common.inspector.tokens.loading")}
      spinnerSize="sm"
      withSparkle={false}
      minHeight="py-10"
    >
      {body}
    </LoadingState>
  );
};
