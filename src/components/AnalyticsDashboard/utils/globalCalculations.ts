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

// ============================================================================
// Model Distribution Metrics
// ============================================================================

export interface ModelDisplayMetrics {
  percentage: number;
  price: number;
  formattedPrice: string;
  formattedTokens: string;
}

interface ModelUsageLike {
  model_name: string;
  token_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface GlobalCostSummary {
  totalEstimatedCost: number;
  coveragePercent: number;
  coveredTokens: number;
}

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
  totalTokens: number
): ModelDisplayMetrics => {
  const price = calculateModelPrice(
    modelName,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens
  );

  const percentage = (tokenCount / Math.max(totalTokens, 1)) * 100;

  const formattedPrice = `$${price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2)}`;
  const formattedTokens = formatNumber(tokenCount);

  return {
    percentage,
    price,
    formattedPrice,
    formattedTokens,
  };
};

export const calculateGlobalCostSummary = (
  models: ModelUsageLike[],
  totalTokens: number
): GlobalCostSummary => {
  let totalEstimatedCost = 0;
  let coveredTokens = 0;

  for (const model of models) {
    totalEstimatedCost += calculateModelPrice(
      model.model_name,
      model.input_tokens,
      model.output_tokens,
      model.cache_creation_tokens,
      model.cache_read_tokens
    );

    if (hasExplicitModelPricing(model.model_name)) {
      coveredTokens += model.token_count;
    }
  }

  const denominator = Math.max(totalTokens, 1);
  const coveragePercent = (coveredTokens / denominator) * 100;

  return {
    totalEstimatedCost,
    coveragePercent,
    coveredTokens,
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
