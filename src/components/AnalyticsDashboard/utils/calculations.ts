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
 * Model API pricing configuration.
 *
 * Prices are USD per 1M tokens. A pricing entry can contain multiple context
 * tiers because several providers change every token rate once a request is
 * above a context threshold. `cacheWrite` is the 5-minute/default write rate;
 * `cacheWriteOneHour` is optional because not every provider publishes a
 * separate one-hour cache rate.
 */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number | null;
  cacheRead: number;
  minContextTokens?: number;
  cacheWriteOneHour?: number | null;
  contextTiers?: ModelPricing[];
  serviceTiers?: Record<string, ModelPricing>;
}

export type CacheWriteTtl = "5m" | "1h";

export interface ModelPriceOptions {
  providerId?: string;
  contextTokens?: number;
  cacheWriteTtl?: CacheWriteTtl;
  /** Provider billing tier, e.g. OpenAI's `standard` or `fast`. */
  serviceTier?: string;
  /** Providers such as Gemini and OpenCode may expose reasoning separately from output. */
  reasoningTokens?: number;
}

type ModelPricingTierOptions = Omit<
  ModelPricing,
  "input" | "output" | "cacheRead" | "cacheWrite"
> & { cacheWrite?: number | null };

const tier = (
  input: number,
  output: number,
  cacheRead: number,
  options: ModelPricingTierOptions = {},
): ModelPricing => ({ input, output, cacheRead, cacheWrite: null, ...options });

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic. Current standard prices; cacheWrite is the 5-minute rate.
  "claude-fable-5": tier(10, 50, 1, { cacheWrite: 12.5, cacheWriteOneHour: 20 }),
  "claude-mythos-5": tier(10, 50, 1, { cacheWrite: 12.5, cacheWriteOneHour: 20 }),
  "claude-mythos-preview": tier(10, 50, 1, { cacheWrite: 12.5, cacheWriteOneHour: 20 }),
  "claude-opus-5": tier(5, 25, 0.5, { cacheWrite: 6.25, cacheWriteOneHour: 10 }),
  "claude-opus-4-8": tier(5, 25, 0.5, { cacheWrite: 6.25, cacheWriteOneHour: 10 }),
  "claude-opus-4-7": tier(5, 25, 0.5, { cacheWrite: 6.25, cacheWriteOneHour: 10 }),
  "claude-opus-4-6": tier(5, 25, 0.5, { cacheWrite: 6.25, cacheWriteOneHour: 10 }),
  "claude-opus-4-5": tier(5, 25, 0.5, { cacheWrite: 6.25, cacheWriteOneHour: 10 }),
  "claude-opus-4-1": tier(15, 75, 1.5, { cacheWrite: 18.75, cacheWriteOneHour: 30 }),
  "claude-opus-4": tier(15, 75, 1.5, { cacheWrite: 18.75, cacheWriteOneHour: 30 }),
  "claude-sonnet-5": tier(2, 10, 0.2, { cacheWrite: 2.5, cacheWriteOneHour: 4 }),
  "claude-sonnet-4-6": tier(3, 15, 0.3, { cacheWrite: 3.75, cacheWriteOneHour: 6 }),
  "claude-sonnet-4-5": tier(3, 15, 0.3, { cacheWrite: 3.75, cacheWriteOneHour: 6 }),
  "claude-sonnet-4": tier(3, 15, 0.3, { cacheWrite: 3.75, cacheWriteOneHour: 6 }),
  "claude-haiku-4-5": tier(1, 5, 0.1, { cacheWrite: 1.25, cacheWriteOneHour: 2 }),
  "claude-3-5-sonnet": tier(3, 15, 0.3, { cacheWrite: 3.75, cacheWriteOneHour: 6 }),
  "claude-3-5-haiku": tier(0.8, 4, 0.08, { cacheWrite: 1, cacheWriteOneHour: 1.6 }),
  "claude-haiku-3": tier(0.25, 1.25, 0.03, { cacheWrite: 0.3, cacheWriteOneHour: 0.5 }),
  "claude-3-haiku": tier(0.25, 1.25, 0.03, { cacheWrite: 0.3, cacheWriteOneHour: 0.5 }),

  // MiniMax. M3 has a second price tier above 512K context.
  "minimax-m3": tier(0.6, 2.4, 0.12, {
    cacheWrite: null,
    contextTiers: [tier(1.2, 4.8, 0.24, { minContextTokens: 512_001, cacheWrite: null })],
  }),
  "minimax-m2.7": tier(0.3, 1.2, 0.06, { cacheWrite: 0.375 }),
  "minimax-m2.5": tier(0.3, 1.2, 0.06, { cacheWrite: 0.375 }),
  "minimax-m2.1": tier(0.3, 1.2, 0.06, { cacheWrite: 0.375 }),

  // OpenAI. Cached input is a separate input rate. Cache writes are only
  // charged for the GPT-5.6 family; older GPT-5 generations do not publish a
  // separate cache-write charge. Long-context GPT-5.4/5.5/5.6 rates apply to
  // the whole request after the 272K prompt threshold is crossed.
  "gpt-5.6": tier(5, 30, 0.5, {
    cacheWrite: 6.25,
    contextTiers: [tier(10, 45, 1, { minContextTokens: 272_001, cacheWrite: 12.5 })],
  }),
  "gpt-5.6-sol": tier(5, 30, 0.5, {
    cacheWrite: 6.25,
    contextTiers: [tier(10, 45, 1, { minContextTokens: 272_001, cacheWrite: 12.5 })],
  }),
  "gpt-5.6-terra": tier(2, 12, 0.2, {
    cacheWrite: 2.5,
    contextTiers: [tier(4, 18, 0.4, { minContextTokens: 272_001, cacheWrite: 5 })],
  }),
  "gpt-5.6-luna": tier(0.2, 1.2, 0.02, {
    cacheWrite: 0.25,
    contextTiers: [tier(0.4, 1.8, 0.04, { minContextTokens: 272_001, cacheWrite: 0.5 })],
  }),
  "gpt-5.6-cyber": tier(12.5, 75, 1.25, { cacheWrite: 15.625 }),
  "daybreak-blue-latest": tier(5, 30, 0.5, { cacheWrite: 6.25 }),
  "daybreak-red-latest": tier(12.5, 75, 1.25, { cacheWrite: 15.625 }),
  "gpt-5.5": tier(5, 30, 0.5, {
    contextTiers: [tier(10, 45, 1, { minContextTokens: 272_001 })],
  }),
  "gpt-5.4": tier(2.5, 15, 0.25, {
    contextTiers: [tier(5, 22.5, 0.5, { minContextTokens: 272_001 })],
  }),
  "gpt-5.4-mini": tier(0.75, 4.5, 0.075),
  "gpt-5.4-nano": tier(0.2, 1.25, 0.02),
  "gpt-5.2": tier(1.75, 14, 0.175),
  "chat-latest": tier(5, 30, 0.5),
  "gpt-5.3-chat-latest": tier(1.75, 14, 0.175),
  "gpt-5.3-codex-fast": tier(3.5, 28, 0.35),
  "gpt-5.3-codex": tier(1.75, 14, 0.175, {
    serviceTiers: {
      fast: tier(3.5, 28, 0.35),
    },
  }),
  "gpt-5.2-codex": tier(1.75, 14, 0.175),
  "gpt-5.1": tier(1.25, 10, 0.125),
  "gpt-5.1-chat-latest": tier(1.25, 10, 0.125),
  "gpt-5.1-codex": tier(1.25, 10, 0.125),
  "gpt-5.1-codex-max": tier(1.25, 10, 0.125),
  "gpt-5": tier(1.25, 10, 0.125),
  "gpt-5-chat-latest": tier(1.25, 10, 0.125),
  "gpt-5-codex": tier(1.25, 10, 0.125),
  "gpt-5-mini": tier(0.25, 2, 0.025),
  "gpt-5-nano": tier(0.05, 0.4, 0.005),
  "gpt-4.1-mini": tier(0.4, 1.6, 0.1, { cacheWrite: null }),
  "gpt-4.1-nano": tier(0.1, 0.4, 0.025, { cacheWrite: null }),
  "gpt-4.1": tier(2, 8, 0.5, { cacheWrite: null }),
  "gpt-4o-mini": tier(0.15, 0.6, 0.075, { cacheWrite: null }),
  "gpt-4o": tier(2.5, 10, 1.25, { cacheWrite: null }),
  "gpt-4": tier(30, 60, 0, { cacheWrite: null }),
  "o4-mini": tier(1.1, 4.4, 0.275, { cacheWrite: null }),
  "codex-mini": tier(1.5, 6, 0.375, { cacheWrite: null }),

  // Google. Gemini output rates include thinking tokens where the API does so.
  // Current promotional paid-tier rates are valid through 2026-12-31.
  "gemini-3.7-flash": tier(0.75, 3.75, 0.075),
  "gemini-3.6-flash": tier(0.75, 3.75, 0.075),
  "gemini-3.5-flash": tier(1.5, 9, 0.15),
  "gemini-3.5-flash-lite": tier(0.3, 2.5, 0.03),
  "gemini-3.1-pro-preview": tier(2, 12, 0.2, {
    contextTiers: [tier(4, 18, 0.4, { minContextTokens: 200_001 })],
  }),
  "gemini-3-flash-preview": tier(0.5, 3, 0.05),
  "gemini-3.1-flash-lite": tier(0.25, 1.5, 0.025),
  "gemini-2.5-pro": tier(1.25, 10, 0.125, {
    contextTiers: [tier(2.5, 15, 0.25, { minContextTokens: 200_001 })],
  }),
  "gemini-2.5-flash": tier(0.3, 2.5, 0.03),
  "gemini-2.5-flash-lite": tier(0.1, 0.4, 0.01),

  // xAI. Long-context rates apply from 200K prompt tokens.
  "grok-4.6": tier(2, 6, 0.5, {
    contextTiers: [tier(4, 12, 1, { minContextTokens: 200_001 })],
  }),
  "grok-4.5": tier(2, 6, 0.3, {
    contextTiers: [tier(4, 12, 0.6, { minContextTokens: 200_001 })],
  }),
  "grok-4.5-build": tier(2, 6, 0.3, {
    contextTiers: [tier(4, 12, 0.6, { minContextTokens: 200_001 })],
  }),
  "grok-build-latest": tier(2, 6, 0.3, {
    contextTiers: [tier(4, 12, 0.6, { minContextTokens: 200_001 })],
  }),
  "grok-build-0.1": tier(1, 2, 0.2, {
    contextTiers: [tier(2, 4, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-code-fast-1-0825": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-code-fast-1": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-code-fast": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-4.3": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-4.20-multi-agent-0309": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-4.20-0309-reasoning": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-4.20-0309-non-reasoning": tier(1.25, 2.5, 0.2, {
    contextTiers: [tier(2.5, 5, 0.4, { minContextTokens: 200_001 })],
  }),
  "grok-4": tier(3, 15, 0.75),
  "grok-build": tier(2, 6, 0.3, {
    contextTiers: [tier(4, 12, 0.6, { minContextTokens: 200_001 })],
  }),

};

const SORTED_MODEL_PRICING_ENTRIES = Object.entries(MODEL_PRICING).sort(
  (a, b) => b[0].length - a[0].length,
);

// These models expose audio/image/video or flat-unit billing that cannot be
// represented by the token-only fields in this dashboard. Keep them out of
// prefix matching so e.g. `gemini-2.5-flash-preview-tts` is not accidentally
// priced as ordinary Gemini 2.5 Flash text traffic.
const TOKEN_UNSUPPORTED_MODEL_PATTERNS = [
  /^(?:gemini-2\.5-(?:flash|pro)-preview-tts)(?:-|$)/,
  /^gemini-2\.5-flash-(?:native-audio|image)(?:-|$)/,
  /^gemini-.*-(?:tts|native-audio|audio|live|image|image-generation|video-generation)(?:-|$)/,
  /^gemini-omni-flash(?:-|$)/,
  /^gemini-(?:3\.5-live-translate|3\.1-flash-live)(?:-|$)/,
  /^gpt-(?:4o(?:-mini)?|4\.1(?:-mini)?)-(?:audio|realtime|tts|transcribe|search-preview)(?:-|$)/,
  /^gpt-(?:realtime|image)(?:-|$)/,
  /^sora(?:-|$)/,
  /^grok-imagine(?:-|$)/,
];

const SOURCE_COST_ONLY_PROVIDER_IDS = new Set([
  "antigravity",
  "copilot",
  "cursor",
  "cursor-agent",
  "opencode",
]);

const normalizeModelName = (modelName: string): string =>
  modelName.trim().toLowerCase().replace(/^models\//, "");

const matchesModelKey = (normalizedModelName: string, key: string): boolean => {
  // Gate on the final provider/model path segment so `openai/gpt-4.1-*` and
  // `anthropic/claude-*` resolve, while `not-gpt-4.1` remains unknown.
  const modelSegment = normalizedModelName.split("/").at(-1) ?? normalizedModelName;
  return modelSegment === key ||
    modelSegment.startsWith(`${key}-`) ||
    modelSegment.startsWith(`${key}@`) ||
    modelSegment.startsWith(`${key}:`);
};

const findModelPricing = (
  modelName: string,
  providerId?: string,
  contextTokens = 0,
  serviceTier?: string,
): ModelPricing | null => {
  // A provider id is part of the billing identity. These products can route
  // the same model through a subscription, proxy, or markup that cannot be
  // reconstructed from token counts. Only an authoritative source cost is
  // safe for them; `calculateGlobalCostSummary` checks that before calling
  // this function.
  const normalizedProviderId = providerId?.trim().toLowerCase();
  if (normalizedProviderId && SOURCE_COST_ONLY_PROVIDER_IDS.has(normalizedProviderId)) {
    return null;
  }

  const normalizedModelName = normalizeModelName(modelName);
  const modelSegment = normalizedModelName.split("/").at(-1) ?? normalizedModelName;
  if (TOKEN_UNSUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(modelSegment))) {
    return null;
  }
  const normalizedServiceTier = serviceTier?.trim().toLowerCase().replace("priority", "fast");
  const candidates = SORTED_MODEL_PRICING_ENTRIES
    .filter(([key]) => matchesModelKey(normalizedModelName, key))
    .flatMap(([key, basePricing]) => {
      const pricing = normalizedServiceTier
        ? basePricing.serviceTiers?.[normalizedServiceTier] ?? basePricing
        : basePricing;
      return [
        { key, pricing },
        ...(pricing.contextTiers ?? []).map((contextPricing) => ({
          key,
          pricing: contextPricing,
        })),
      ];
    })
    .filter(({ pricing }) =>
      pricing.minContextTokens == null || contextTokens >= pricing.minContextTokens,
    )
    .sort((a, b) =>
      b.key.length - a.key.length ||
      (b.pricing.minContextTokens ?? 0) - (a.pricing.minContextTokens ?? 0),
    );

  if (candidates.length === 0) return null;

  return candidates.at(0)?.pricing ?? null;
};

export const hasExplicitModelPricing = (modelName: string, providerId?: string): boolean =>
  findModelPricing(modelName, providerId) != null;

/**
 * Calculate API pricing for a model
 */
export const calculateModelPrice = (
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  options: ModelPriceOptions = {},
): number | null => {
  const modelPricing = findModelPricing(
    modelName,
    options.providerId,
    options.contextTokens ?? 0,
    options.serviceTier,
  );

  if (!modelPricing) return null;

  const inputCost = (inputTokens / 1000000) * modelPricing.input;
  // The provider adapters keep reasoning separate so it remains visible in
  // token distributions. It is nevertheless billed at the output rate by
  // the token-priced APIs represented here.
  const billableOutputTokens = outputTokens + (options.reasoningTokens ?? 0);
  const outputCost = (billableOutputTokens / 1000000) * modelPricing.output;
  const cacheWriteRate = options.cacheWriteTtl === "1h"
    ? modelPricing.cacheWriteOneHour ?? modelPricing.cacheWrite
    : modelPricing.cacheWrite;
  const cacheWriteCost = cacheWriteRate == null
    ? 0
    : (cacheCreationTokens / 1000000) * cacheWriteRate;
  const cacheReadCost = (cacheReadTokens / 1000000) * modelPricing.cacheRead;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
};

/**
 * Format a number as a currency string (USD)
 */
export const formatCurrency = (value: number): string =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  })}`;

/**
 * Get heatmap color based on intensity
 */
export const getHeatColor = (intensity: number): string => {
  if (intensity === 0) return "var(--heatmap-empty)";
  if (intensity <= 0.3) return "var(--heatmap-low)";
  if (intensity <= 0.6) return "var(--heatmap-medium)";
  return "var(--heatmap-high)";
};
