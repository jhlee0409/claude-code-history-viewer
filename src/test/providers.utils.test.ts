import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
  hasNonDefaultProvider,
  getProviderId,
  getProviderLabel,
  normalizeProviderIds,
  PROVIDER_IDS,
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
});
