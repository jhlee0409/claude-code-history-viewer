/**
 * Global Analytics Calculations
 *
 * Utility functions for global (cross-project) analytics calculations.
 */

import { calculateModelPrice, formatNumber } from "./calculations";

// ============================================================================
// Model Distribution Metrics
// ============================================================================

export interface ModelDisplayMetrics {
  percentage: number;
  price: number;
  formattedPrice: string;
  formattedTokens: string;
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

// ============================================================================
// Project Ranking
// ============================================================================

export type RankMedal = "🥇" | "🥈" | "🥉" | null;

/**
 * Get medal emoji for top 3 ranks
 */
export const getRankMedal = (index: number): RankMedal => {
  const medals: RankMedal[] = ["🥇", "🥈", "🥉"];
  return index < 3 ? medals[index] : null;
};

/**
 * Check if index qualifies for medal display
 */
export const hasMedal = (index: number): boolean => index < 3;
