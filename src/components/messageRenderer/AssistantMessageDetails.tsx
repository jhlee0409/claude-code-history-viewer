import React from 'react';
import { CircleQuestionMark, DollarSign, Clock } from 'lucide-react';
import type { ClaudeMessage } from '../../types';
import { useTranslation } from 'react-i18next';
import { layout } from '@/components/renderers';
import {
  calculateModelPrice,
  hasExplicitModelPricing,
} from '@/components/AnalyticsDashboard/utils/calculations';
import { ModelLifecycleBadge } from '@/components/ModelLifecycleBadge';
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

interface AssistantMessageDetailsProps {
  message: ClaudeMessage;
}

export const AssistantMessageDetails: React.FC<AssistantMessageDetailsProps> = ({ message }) => {
  const { t } = useTranslation();
  const fmt = useFormat();

  if (message.type !== 'assistant') {
    return null;
  }

  const { model, usage, costUSD, durationMs, provider } = message;

  if (!model) {
    return null;
  }

  // Modern Claude Code stopped writing `costUSD` to its JSONL files. When it's
  // missing but we have a model + usage payload, fall back to the same pricing
  // table the analytics dashboard uses so the cost slot doesn't disappear (#194).
  // Mark the value as estimated so users know it's not authoritative.
  const explicitCost = costUSD !== undefined && costUSD !== null ? costUSD : null;
  const nestedCacheCreationTokens5m = usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const nestedCacheCreationTokens1h = usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheCreationTokens1h = usage?.cache_creation_input_tokens_1h
    ?? nestedCacheCreationTokens1h;
  const reportedCacheCreationTokens5m = usage?.cache_creation_input_tokens_5m
    ?? nestedCacheCreationTokens5m;
  const cacheCreationTokens = usage?.cache_creation_input_tokens
    ?? reportedCacheCreationTokens5m + cacheCreationTokens1h;
  const cacheCreationTokens5m = usage?.cache_creation_input_tokens_5m
    ?? (usage?.cache_creation_input_tokens == null
      ? reportedCacheCreationTokens5m
      : Math.max(cacheCreationTokens - cacheCreationTokens1h, 0));
  const contextTokens =
    (usage?.input_tokens ?? 0) + cacheCreationTokens + (usage?.cache_read_input_tokens ?? 0);
  const estimatedCost =
    explicitCost == null && usage && hasExplicitModelPricing(model, provider)
      ? (() => {
          const options = {
            providerId: provider,
            serviceTier: usage.service_tier,
            contextTokens,
            reasoningTokens: usage.reasoning_tokens,
          };
          const baseCost = calculateModelPrice(
            model,
            usage.input_tokens ?? 0,
            usage.output_tokens ?? 0,
            cacheCreationTokens5m,
            usage.cache_read_input_tokens ?? 0,
            { ...options, cacheWriteTtl: "5m" },
          );
          const oneHourCost = cacheCreationTokens1h > 0
            ? calculateModelPrice(
                model,
                0,
                0,
                cacheCreationTokens1h,
                0,
                { ...options, cacheWriteTtl: "1h", reasoningTokens: 0 },
              )
            : 0;
          return baseCost == null || oneHourCost == null ? null : baseCost + oneHourCost;
        })()
      : null;
  const displayCost = explicitCost ?? estimatedCost;
  const isEstimated = displayCost != null && explicitCost == null;
  const hasUsage = usage != null && (
    (usage.input_tokens ?? 0) > 0 ||
    (usage.output_tokens ?? 0) > 0 ||
    (usage.cache_creation_input_tokens ?? 0) > 0 ||
    (usage.cache_creation_input_tokens_5m ?? 0) > 0 ||
    (usage.cache_creation_input_tokens_1h ?? 0) > 0 ||
    (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0 ||
    (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0 ||
    (usage.cache_read_input_tokens ?? 0) > 0 ||
    (usage.reasoning_tokens ?? 0) > 0
  );

  return (
    <div className={`flex items-center justify-start mt-1.5 ${layout.iconSpacing} ${layout.smallText} text-muted-foreground flex-wrap gap-y-1`}>
      <span className="flex items-center gap-1.5">
        {t('assistantMessageDetails.model')}: {model}
        <ModelLifecycleBadge model={model} />
      </span>

      {/* Cost display (authoritative when costUSD present, otherwise estimated from pricing table) */}
      {displayCost != null && (
        <span
          className={`flex items-center text-success ${layout.iconSpacing}`}
          title={isEstimated ? t('assistantMessageDetails.costEstimated', { defaultValue: 'Estimated from token usage; the source JSONL did not include costUSD.' }) : undefined}
        >
          <DollarSign className={layout.iconSizeSmall} />
          <span><Num>{isEstimated ? `~${fmt.cost(displayCost)}` : fmt.cost(displayCost)}</Num></span>
        </span>
      )}

      {/* Duration display */}
      {durationMs !== undefined && durationMs > 0 && (
        <span className={`flex items-center text-info ${layout.iconSpacing}`}>
          <Clock className={layout.iconSizeSmall} />
          <span><Num>{fmt.duration(durationMs)}</Num></span>
        </span>
      )}

      {/* Token usage tooltip */}
      {usage && hasUsage && (
        <div className="relative group">
          <button
            type="button"
            className="p-0 border-0 bg-transparent cursor-help"
            aria-label={t('assistantMessageDetails.tokenUsageLabel', { defaultValue: 'View token usage details' })}
            aria-describedby="token-usage-tooltip"
          >
            <CircleQuestionMark className={layout.iconSize} aria-hidden="true" />
          </button>
          <div
            id="token-usage-tooltip"
            role="tooltip"
            className={`absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 bg-popover text-popover-foreground ${layout.smallText} ${layout.rounded} ${layout.containerPadding} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none shadow-lg z-10 border border-border`}
          >
            <p><strong>{t('assistantMessageDetails.tokenUsage')}</strong></p>
            {usage.input_tokens ? <p>{t('assistantMessageDetails.input')}: <Num>{fmt.count(usage.input_tokens)}</Num></p> : null}
            {usage.output_tokens ? <p>{t('assistantMessageDetails.output')}: <Num>{fmt.count(usage.output_tokens)}</Num></p> : null}
            {cacheCreationTokens ? <p>{t('assistantMessageDetails.cacheCreation')}: <Num>{fmt.count(cacheCreationTokens)}</Num></p> : null}
            {usage.cache_read_input_tokens ? <p>{t('assistantMessageDetails.cacheRead')}: <Num>{fmt.count(usage.cache_read_input_tokens)}</Num></p> : null}
            {usage.reasoning_tokens ? <p>{t('assistantMessageDetails.reasoning', { defaultValue: 'Reasoning' })}: <Num>{fmt.count(usage.reasoning_tokens)}</Num></p> : null}
            {usage.service_tier ? <p>{t('assistantMessageDetails.tier')}: {usage.service_tier}</p> : null}
            {displayCost != null && (
              <p className="mt-1 pt-1 border-t border-border">
                {t('assistantMessageDetails.cost', { defaultValue: 'Cost' })}: <Num>{isEstimated ? `~${fmt.cost(displayCost)}` : fmt.cost(displayCost)}</Num>
                {isEstimated ? <span className="ml-1 opacity-70">({t('assistantMessageDetails.estimated', { defaultValue: 'estimated' })})</span> : null}
              </p>
            )}
            {durationMs !== undefined && <p>{t('assistantMessageDetails.duration', { defaultValue: 'Duration' })}: <Num>{fmt.duration(durationMs)}</Num></p>}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-popover" aria-hidden="true"></div>
          </div>
        </div>
      )}
    </div>
  );
};
