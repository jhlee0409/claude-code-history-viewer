/**
 * Analytics Calculations
 *
 * Helper functions for analytics calculations and formatting.
 */

/**
 * Calculate growth rate between two values
 */
export const calculateGrowthRate = (current: number, previous: number): number => {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
};

/**
 * Format large numbers with precision (K, M suffixes)
 */
export const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

/**
 * Claude API pricing configuration
 */
interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude models
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-haiku': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
  // OpenAI models (Codex CLI) - specific keys must precede prefix matches
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheWrite: 0, cacheRead: 0 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0 },
  'gpt-4.1': { input: 2, output: 8, cacheWrite: 0, cacheRead: 0 },
  'o4-mini': { input: 1.1, output: 4.4, cacheWrite: 0, cacheRead: 0 },
  'codex-mini': { input: 1.5, output: 6, cacheWrite: 0, cacheRead: 0 },
  // Google models (OpenCode)
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60, cacheWrite: 0, cacheRead: 0 },
};

const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };

/**
 * Calculate Claude API pricing for a model
 */
export const calculateModelPrice = (
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number
): number => {
  let modelPricing = DEFAULT_PRICING;

  // Sort by key length descending so more specific keys match first
  // (e.g., "gpt-4.1-mini" matches before "gpt-4.1")
  const entries = Object.entries(MODEL_PRICING).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [key, value] of entries) {
    if (modelName.toLowerCase().includes(key)) {
      modelPricing = value;
      break;
    }
  }

  const inputCost = (inputTokens / 1000000) * modelPricing.input;
  const outputCost = (outputTokens / 1000000) * modelPricing.output;
  const cacheWriteCost = (cacheCreationTokens / 1000000) * modelPricing.cacheWrite;
  const cacheReadCost = (cacheReadTokens / 1000000) * modelPricing.cacheRead;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
};

/**
 * Get heatmap color based on intensity
 */
export const getHeatColor = (intensity: number): string => {
  if (intensity === 0) return "var(--heatmap-empty)";
  if (intensity <= 0.3) return "var(--heatmap-low)";
  if (intensity <= 0.6) return "var(--heatmap-medium)";
  return "var(--heatmap-high)";
};
