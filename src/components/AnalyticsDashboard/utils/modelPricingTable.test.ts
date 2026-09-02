import { describe, expect, it } from "vitest";
import pricingTable from "../../../data/model-pricing.json";
import type { ModelPricing } from "./calculations";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROVIDERS = new Set(["anthropic", "openai", "google", "xai", "minimax"]);

const isRate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const expectTier = (tier: ModelPricing, path: string) => {
  expect(isRate(tier.input), `${path}.input`).toBe(true);
  expect(isRate(tier.output), `${path}.output`).toBe(true);
  expect(isRate(tier.cacheRead), `${path}.cacheRead`).toBe(true);
  expect(tier.cacheWrite === null || isRate(tier.cacheWrite), `${path}.cacheWrite`).toBe(true);
  if (tier.cacheWriteOneHour !== undefined) {
    expect(tier.cacheWriteOneHour === null || isRate(tier.cacheWriteOneHour), `${path}.cacheWriteOneHour`).toBe(true);
  }
  for (const [index, contextTier] of (tier.contextTiers ?? []).entries()) {
    const tierPath = `${path}.contextTiers[${index}]`;
    expect(contextTier.minContextTokens, `${tierPath}.minContextTokens`).toBeGreaterThan(0);
    expect(contextTier.contextTiers, `${tierPath} must not nest context tiers`).toBeUndefined();
    expectTier(contextTier, tierPath);
  }
  for (const [name, serviceTier] of Object.entries(tier.serviceTiers ?? {})) {
    expect(serviceTier.serviceTiers, `${path}.serviceTiers.${name} must not nest service tiers`).toBeUndefined();
    expectTier(serviceTier, `${path}.serviceTiers.${name}`);
  }
};

describe("model-pricing.json", () => {
  it("records an audit date", () => {
    expect(pricingTable.auditedAt).toMatch(ISO_DATE);
  });

  it("every entry is sourced, dated, and shaped like ModelPricing", () => {
    const entries = Object.entries(pricingTable.models);
    expect(entries.length).toBeGreaterThan(0);

    for (const [key, entry] of entries) {
      expect(key, "keys are lowercase model ids").toBe(key.trim().toLowerCase());
      expect(PROVIDERS.has(entry.provider), `${key}.provider`).toBe(true);
      expect(entry.source, `${key}.source`).toMatch(/^https:\/\//);
      expect(entry.verifiedAt, `${key}.verifiedAt`).toMatch(ISO_DATE);
      expect(entry.verifiedAt <= pricingTable.auditedAt, `${key} verified after the audit date`).toBe(true);
      if ("deprecatedAt" in entry) expect(entry.deprecatedAt, `${key}.deprecatedAt`).toMatch(ISO_DATE);
      expectTier(entry, key);
    }
  });

  it("keeps aliases in sync with the model they point at", () => {
    const { models } = pricingTable;
    const rates = (entry: ModelPricing) => JSON.stringify([entry.input, entry.output, entry.cacheRead, entry.cacheWrite, entry.contextTiers]);
    expect(rates(models["gpt-daybreak-blue-latest"])).toBe(rates(models["gpt-5.6-sol"]));
    expect(rates(models["gpt-daybreak-red-latest"])).toBe(rates(models["gpt-5.6-cyber"]));
    expect(rates(models["grok-build-latest"])).toBe(rates(models["grok-4.5"]));
    for (const alias of ["grok-code-fast-1", "grok-code-fast", "grok-code-fast-1-0825"]) {
      expect(rates(models[alias]), alias).toBe(rates(models["grok-build-0.1"]));
    }
  });
});
