/**
 * Global Analytics Calculations
 *
 * Utility functions for global (cross-project) analytics calculations.
 */

import {
  calculateModelPrice,
  formatNumber,
  hasExplicitModelPricing,
} from "./calculations";
import type { ModelContextStats } from "../../../types";

// ============================================================================
// Model Distribution Metrics
// ============================================================================

export interface ModelDisplayMetrics {
  percentage: number;
  price: number | null;
  formattedPrice: string;
  formattedTokens: string;
  pricingStatus: "exact" | "estimated" | "unavailable";
}

export interface ModelUsageLike {
  model_name: string;
  provider_id?: string;
  service_tier?: string;
  token_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens?: number;
  cost_usd?: number | null;
  context_breakdown?: ModelContextStats[];
}

export interface GlobalCostSummary {
  totalEstimatedCost: number;
  exactCost: number;
  estimatedCost: number;
  coveragePercent: number;
  coveredTokens: number;
  unpricedTokens: number;
  unpricedModels: number;
  pricedModels: number;
  exactModels: number;
  estimatedModels: number;
}

const calculateContextBreakdownPrice = (
  modelName: string,
  usage: Pick<
    ModelUsageLike,
    | "input_tokens"
    | "output_tokens"
    | "cache_creation_tokens"
    | "cache_read_tokens"
    | "reasoning_tokens"
    | "context_breakdown"
    | "provider_id"
    | "service_tier"
  >,
): number | null => {
  const breakdown = usage.context_breakdown;
  if (!breakdown || breakdown.length === 0) {
    return calculateModelPrice(
      modelName,
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_creation_tokens,
      usage.cache_read_tokens,
      {
        providerId: usage.provider_id,
        serviceTier: usage.service_tier,
        // Legacy payloads do not have per-request buckets. Keep them in the
        // default tier rather than incorrectly treating aggregate tokens as a
        // single long-context request.
        contextTokens: 0,
        reasoningTokens: usage.reasoning_tokens,
      },
    );
  }

  let total = 0;
  for (const bucket of breakdown) {
    const cacheCreation5m = bucket.cache_creation_tokens_5m ?? bucket.cache_creation_tokens;
    const cacheCreation1h = bucket.cache_creation_tokens_1h ?? 0;
    const options = {
      providerId: usage.provider_id,
      serviceTier: usage.service_tier,
      contextTokens: bucket.min_context_tokens,
      reasoningTokens: bucket.reasoning_tokens,
    };
    const basePrice = calculateModelPrice(
      modelName,
      bucket.input_tokens,
      bucket.output_tokens,
      cacheCreation5m,
      bucket.cache_read_tokens,
      { ...options, cacheWriteTtl: "5m" },
    );
    const oneHourPrice = cacheCreation1h > 0
      ? calculateModelPrice(
          modelName,
          0,
          0,
          cacheCreation1h,
          0,
          { ...options, cacheWriteTtl: "1h", reasoningTokens: 0 },
        )
      : 0;
    if (basePrice == null || oneHourPrice == null) return null;
    total += basePrice + oneHourPrice;
  }
  return total;
};

/**
 * Calculate display metrics for a single model
 */
export const calculateModelMetrics = (
  modelName: string,
  tokenCount: number,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  totalTokens: number,
  options: {
    providerId?: string;
    serviceTier?: string;
    reasoningTokens?: number;
    sourceCostUSD?: number | null;
    contextTokens?: number;
    contextBreakdown?: ModelContextStats[];
  } = {},
): ModelDisplayMetrics => {
  const hasSourceCost = options.sourceCostUSD !== undefined && options.sourceCostUSD !== null;
  const price = hasSourceCost
    ? options.sourceCostUSD ?? null
    : options.contextBreakdown
      ? calculateContextBreakdownPrice(modelName, {
          provider_id: options.providerId,
          service_tier: options.serviceTier,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_tokens: cacheCreationTokens,
          cache_read_tokens: cacheReadTokens,
          reasoning_tokens: options.reasoningTokens,
          context_breakdown: options.contextBreakdown,
        })
      : calculateModelPrice(
          modelName,
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          {
            providerId: options.providerId,
            serviceTier: options.serviceTier,
            contextTokens: options.contextTokens ?? 0,
            reasoningTokens: options.reasoningTokens,
          },
        );

  const percentage = (tokenCount / Math.max(totalTokens, 1)) * 100;

  const formattedPrice = price == null
    ? "—"
    : `$${price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2)}`;
  const formattedTokens = formatNumber(tokenCount);

  return {
    percentage,
    price,
    formattedPrice,
    formattedTokens,
    pricingStatus: hasSourceCost
      ? "exact"
      : price == null
        ? "unavailable"
        : "estimated",
  };
};

export const calculateGlobalCostSummary = (
  models: ModelUsageLike[],
  totalTokens: number
): GlobalCostSummary => {
  let totalEstimatedCost = 0;
  let exactCost = 0;
  let estimatedCost = 0;
  let coveredTokens = 0;
  let unpricedTokens = 0;
  let unpricedModels = 0;
  let pricedModels = 0;
  let exactModels = 0;
  let estimatedModels = 0;

  for (const model of models) {
    const hasSourceCost = model.cost_usd !== undefined && model.cost_usd !== null;
    const price = hasSourceCost
      ? model.cost_usd ?? 0
      : calculateContextBreakdownPrice(model.model_name, model);

    if (price == null) {
      unpricedTokens += model.token_count;
      unpricedModels += 1;
    } else {
      totalEstimatedCost += price;
      if (hasSourceCost) {
        exactCost += price;
        exactModels += 1;
      } else {
        estimatedCost += price;
        estimatedModels += 1;
      }
      pricedModels += 1;
    }

    if (hasSourceCost || hasExplicitModelPricing(model.model_name, model.provider_id)) {
      coveredTokens += model.token_count;
    }
  }

  const denominator = Math.max(totalTokens, 1);
  const coveragePercent = (coveredTokens / denominator) * 100;

  return {
    totalEstimatedCost,
    exactCost,
    estimatedCost,
    coveragePercent,
    coveredTokens,
    unpricedTokens,
    unpricedModels,
    pricedModels,
    exactModels,
    estimatedModels,
  };
};

// ============================================================================
// Project Ranking
// ============================================================================

export type RankMedal = "🥇" | "🥈" | "🥉" | null;

/**
 * Get medal emoji for top 3 ranks
 */
export const getRankMedal = (index: number): RankMedal => {
  const medals: RankMedal[] = ["🥇", "🥈", "🥉"];
  return index < 3 ? (medals[index] as RankMedal) : null;
};

/**
 * Check if index qualifies for medal display
 */
export const hasMedal = (index: number): boolean => index < 3;
