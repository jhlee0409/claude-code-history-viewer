import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
  calculateConversationBreakdownCoverage,
  hasAnyConversationBreakdownProvider,
  hasNonDefaultProvider,
  getProviderId,
  getProviderLabel,
  normalizeProviderIds,
  PROVIDER_IDS,
  supportsConversationBreakdown,
} from "@/utils/providers";

describe("providers utils", () => {
  it("normalizes provider ids by canonical order", () => {
    const ids = normalizeProviderIds(["opencode", "claude", "opencode"]);
    expect(ids).toEqual(["claude", "opencode"]);
  });

  it("falls back to default provider for unknown values", () => {
    expect(getProviderId(undefined)).toBe(DEFAULT_PROVIDER_ID);
    expect(getProviderId("invalid")).toBe(DEFAULT_PROVIDER_ID);
  });

  it("returns localized provider label", () => {
    const translate = (key: string, fallback: string) => `${key}:${fallback}`;
    expect(getProviderLabel(translate, "codex")).toBe(
      "common.provider.codex:Codex CLI"
    );
  });

  it("detects non-default provider selection", () => {
    expect(hasNonDefaultProvider(["claude"])).toBe(false);
    expect(hasNonDefaultProvider(["claude", "opencode"])).toBe(true);
  });

  it("keeps provider id list stable for all known providers", () => {
    expect(PROVIDER_IDS).toEqual(["claude", "codex", "opencode"]);
  });

  it("knows which providers support conversation breakdown", () => {
    expect(supportsConversationBreakdown("claude")).toBe(true);
    expect(supportsConversationBreakdown("codex")).toBe(false);
    expect(supportsConversationBreakdown("opencode")).toBe(false);
    expect(supportsConversationBreakdown("unknown")).toBe(false);
  });

  it("detects whether current scope has any supported provider", () => {
    expect(hasAnyConversationBreakdownProvider(["claude"])).toBe(true);
    expect(hasAnyConversationBreakdownProvider(["codex", "opencode"])).toBe(
      false
    );
    expect(hasAnyConversationBreakdownProvider([])).toBe(false);
    expect(hasAnyConversationBreakdownProvider(undefined)).toBe(false);
  });

  it("calculates conversation breakdown coverage by provider tokens", () => {
    const coverage = calculateConversationBreakdownCoverage([
      { provider_id: "claude", tokens: 70 },
      { provider_id: "codex", tokens: 20 },
      { provider_id: "opencode", tokens: 10 },
    ]);

    expect(coverage.totalTokens).toBe(100);
    expect(coverage.coveredTokens).toBe(70);
    expect(coverage.coveragePercent).toBe(70);
    expect(coverage.hasLimitedProviders).toBe(true);
  });
});
