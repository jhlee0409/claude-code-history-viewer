/**
 * Analytics Calculations
 *
 * Helper functions for analytics calculations and formatting.
 */

import pricingTable from "@/data/model-pricing.json";

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
 * The rates live in `src/data/model-pricing.json` (USD per 1M tokens) so they
 * can be diffed, audited, and checked by `scripts/check-model-pricing.mjs`.
 * Every entry carries the official source URL and the date it was verified;
 * see `docs/pricing-sources/` for the per-provider audit notes.
 *
 * A pricing entry can contain multiple context tiers because several
 * providers change every token rate once a request is above a context
 * threshold. `cacheWrite` is the 5-minute/default write rate;
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

interface ModelPricingEntry extends ModelPricing {
  provider: "anthropic" | "openai" | "google" | "xai" | "minimax";
  /** Official page the rates were read from. */
  source: string;
  /** ISO date the rates were last confirmed against `source`. */
  verifiedAt: string;
  /** ISO retirement/shutdown date when the provider has announced one. */
  deprecatedAt?: string;
  /** Provider-recommended replacement model id, when announced with the retirement. */
  replacedBy?: string;
  note?: string;
}

interface ModelPricingTable {
  /** ISO date of the last full audit of every entry. */
  auditedAt: string;
  models: Record<string, ModelPricingEntry>;
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

// JSON widens `provider` to `string`; the shape is enforced by
// `modelPricingTable.test.ts` rather than at runtime.
const MODEL_PRICING_TABLE = pricingTable as ModelPricingTable;

export const MODEL_PRICING_AUDITED_AT = MODEL_PRICING_TABLE.auditedAt;

const MODEL_PRICING: Record<string, ModelPricingEntry> = MODEL_PRICING_TABLE.models;

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
  const rawServiceTier = serviceTier?.trim().toLowerCase();
  const normalizedServiceTier = rawServiceTier === "priority" ? "fast" : rawServiceTier;
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

export interface ModelLifecycle {
  /** `retired`: past the provider's shutdown date. `retiring`: shutdown within the notice window. */
  status: "active" | "retiring" | "retired";
  deprecatedAt?: string;
  replacedBy?: string;
}

/** Days before a shutdown date at which a model is reported as `retiring`. */
export const MODEL_RETIRING_WINDOW_DAYS = 90;

/**
 * Lifecycle status of a model from the provider's announced shutdown date.
 * Independent of billing: subscription/proxy providers still get an answer
 * because the model itself is what retires. Unknown ids return null.
 */
export const getModelLifecycle = (
  modelName: string,
  today: Date = new Date(),
): ModelLifecycle | null => {
  const normalizedModelName = normalizeModelName(modelName);
  const entry = SORTED_MODEL_PRICING_ENTRIES
    .find(([key]) => matchesModelKey(normalizedModelName, key))?.[1];
  if (!entry) return null;
  if (!entry.deprecatedAt) return { status: "active" };

  // Provider dates are calendar days; compare against the user's local day,
  // not the UTC day, so the flip does not happen hours early west of UTC.
  const localIsoDate = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const todayIso = localIsoDate(today);
  const horizonIso = localIsoDate(new Date(today.getTime() + MODEL_RETIRING_WINDOW_DAYS * 86_400_000));
  const status = entry.deprecatedAt <= todayIso
    ? "retired"
    : entry.deprecatedAt <= horizonIso
      ? "retiring"
      : "active";
  return { status, deprecatedAt: entry.deprecatedAt, replacedBy: entry.replacedBy };
};

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
