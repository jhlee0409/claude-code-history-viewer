import React from 'react';
import { HelpCircle, DollarSign, Clock } from 'lucide-react';
import type { ClaudeMessage } from '../../types';
import { useTranslation } from 'react-i18next';
import { layout } from '@/components/renderers';

interface AssistantMessageDetailsProps {
  message: ClaudeMessage;
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

const formatCost = (usd: number): string => {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
};

export const AssistantMessageDetails: React.FC<AssistantMessageDetailsProps> = ({ message }) => {
  const { t } = useTranslation('components');
  const { model, usage, type, costUSD, durationMs } = message;

  if (type !== 'assistant' || !model) {
    return null;
  }

  return (
    <div className={`flex items-center justify-start mt-1.5 ${layout.iconSpacing} ${layout.smallText} text-muted-foreground flex-wrap gap-y-1`}>
      <span>{t('assistantMessageDetails.model')}: {model}</span>

      {/* Cost display */}
      {costUSD !== undefined && costUSD > 0 && (
        <span className={`flex items-center text-success ${layout.iconSpacing}`}>
          <DollarSign className={layout.iconSizeSmall} />
          <span>{formatCost(costUSD)}</span>
        </span>
      )}

      {/* Duration display */}
      {durationMs !== undefined && durationMs > 0 && (
        <span className={`flex items-center text-info ${layout.iconSpacing}`}>
          <Clock className={layout.iconSizeSmall} />
          <span>{formatDuration(durationMs)}</span>
        </span>
      )}

      {/* Token usage tooltip */}
      {usage && (usage.input_tokens || usage.output_tokens) && (
        <div className="relative group">
          <button
            type="button"
            className="p-0 border-0 bg-transparent cursor-help"
            aria-label={t('assistantMessageDetails.tokenUsageLabel', { defaultValue: 'View token usage details' })}
            aria-describedby="token-usage-tooltip"
          >
            <HelpCircle className={layout.iconSize} aria-hidden="true" />
          </button>
          <div
            id="token-usage-tooltip"
            role="tooltip"
            className={`absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 bg-popover text-popover-foreground ${layout.smallText} ${layout.rounded} ${layout.containerPadding} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-10 border border-border`}
          >
            <p><strong>{t('assistantMessageDetails.tokenUsage')}</strong></p>
            {usage.input_tokens ? <p>{t('assistantMessageDetails.input')}: {usage.input_tokens.toLocaleString()}</p> : null}
            {usage.output_tokens ? <p>{t('assistantMessageDetails.output')}: {usage.output_tokens.toLocaleString()}</p> : null}
            {usage.cache_creation_input_tokens ? <p>{t('assistantMessageDetails.cacheCreation')}: {usage.cache_creation_input_tokens.toLocaleString()}</p> : null}
            {usage.cache_read_input_tokens ? <p>{t('assistantMessageDetails.cacheRead')}: {usage.cache_read_input_tokens.toLocaleString()}</p> : null}
            {usage.service_tier ? <p>{t('assistantMessageDetails.tier')}: {usage.service_tier}</p> : null}
            {costUSD !== undefined && <p className="mt-1 pt-1 border-t border-border">{t('assistantMessageDetails.cost', { defaultValue: 'Cost' })}: {formatCost(costUSD)}</p>}
            {durationMs !== undefined && <p>{t('assistantMessageDetails.duration', { defaultValue: 'Duration' })}: {formatDuration(durationMs)}</p>}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-popover" aria-hidden="true"></div>
          </div>
        </div>
      )}
    </div>
  );
};