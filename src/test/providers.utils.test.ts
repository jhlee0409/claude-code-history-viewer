import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_IDS,
  calculateConversationBreakdownCoverage,
  getProviderId,
  getProviderLabel,
  getResumeCommand,
  hasAnyConversationBreakdownProvider,
  hasNonDefaultProvider,
  normalizeProviderIds,
  supportsConversationBreakdown,
  supportsNativeRename,
  supportsSessionDeletion,
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
    expect(PROVIDER_IDS).toEqual([
      "aider",
      "antigravity",
      "claude",
      "cline",
      "codex",
      "cursor",
      "forgecode",
      "gemini",
      "opencode",
    ]);
  });

  it("knows which providers support conversation breakdown", () => {
    expect(supportsConversationBreakdown("claude")).toBe(true);
    expect(supportsConversationBreakdown("antigravity")).toBe(true);
    expect(supportsConversationBreakdown("forgecode")).toBe(true);
    expect(supportsConversationBreakdown("codex")).toBe(false);
    expect(supportsConversationBreakdown("opencode")).toBe(false);
    expect(supportsConversationBreakdown("unknown")).toBe(false);
  });

  it("reports provider capabilities for ForgeCode parity actions", () => {
    expect(supportsNativeRename("forgecode")).toBe(true);
    expect(supportsSessionDeletion("forgecode")).toBe(true);
    expect(getResumeCommand("forgecode", "conversation-123")).toBe(
      "forge conversation resume conversation-123"
    );
  });

  it("returns the codex resume subcommand for codex sessions", () => {
    expect(getResumeCommand("codex", "abc-123")).toBe("codex resume abc-123");
  });

  it("getResumeCommand fails closed for unknown provider strings", () => {
    expect(getResumeCommand("not-a-real-provider", "abc")).toBeNull();
    expect(getResumeCommand(undefined, "abc")).toBeNull();
    expect(getResumeCommand("claude", "")).toBeNull();
    // Aider has no resume CLI command — must stay null even after future additions.
    expect(getResumeCommand("aider", "abc")).toBeNull();
  });

  it("prefixes the resume command with `cd` when cwd is provided", () => {
    expect(getResumeCommand("claude", "abc", "/Users/foo/proj")).toBe(
      "cd '/Users/foo/proj' && claude --resume abc"
    );
    expect(getResumeCommand("codex", "abc", "/Users/foo/proj")).toBe(
      "cd '/Users/foo/proj' && codex resume abc"
    );
    expect(getResumeCommand("forgecode", "abc", "/Users/foo/proj")).toBe(
      "cd '/Users/foo/proj' && forge conversation resume abc"
    );
  });

  it("getResumeCommand rejects session ids with shell-meaningful chars", () => {
    // Defense-in-depth: even though CLIs only emit UUID-like IDs, a crafted
    // JSONL must not be able to extend the clipboard command.
    expect(getResumeCommand("claude", "abc; rm -rf /")).toBeNull();
    expect(getResumeCommand("codex", "abc && evil")).toBeNull();
    expect(getResumeCommand("claude", "abc def")).toBeNull();
    expect(getResumeCommand("claude", "$(whoami)")).toBeNull();
    // Allowed charset: alnum, underscore, hyphen.
    expect(getResumeCommand("claude", "abc-123_XYZ")).toBe(
      "claude --resume abc-123_XYZ"
    );
  });

  it("omits the cd prefix when cwd is empty or missing", () => {
    expect(getResumeCommand("claude", "abc", undefined)).toBe(
      "claude --resume abc"
    );
    expect(getResumeCommand("claude", "abc", "")).toBe("claude --resume abc");
  });

  it("single-quotes paths with spaces and escapes embedded apostrophes", () => {
    expect(getResumeCommand("claude", "abc", "/Users/me/My Stuff")).toBe(
      "cd '/Users/me/My Stuff' && claude --resume abc"
    );
    // POSIX trick: close quote, escaped literal apostrophe, reopen quote.
    expect(getResumeCommand("codex", "abc", "/tmp/it's-mine")).toBe(
      "cd '/tmp/it'\\''s-mine' && codex resume abc"
    );
  });

  it("detects whether current scope has any supported provider", () => {
    expect(hasAnyConversationBreakdownProvider(["claude"])).toBe(true);
    expect(hasAnyConversationBreakdownProvider(["antigravity"])).toBe(true);
    expect(hasAnyConversationBreakdownProvider(["forgecode"])).toBe(true);
    expect(hasAnyConversationBreakdownProvider(["codex", "opencode"])).toBe(
      false
    );
    expect(hasAnyConversationBreakdownProvider([])).toBe(false);
    expect(hasAnyConversationBreakdownProvider(undefined)).toBe(false);
  });

  it("calculates conversation breakdown coverage by provider tokens", () => {
    const coverage = calculateConversationBreakdownCoverage([
      { provider_id: "claude", tokens: 70 },
      { provider_id: "antigravity", tokens: 20 },
      { provider_id: "codex", tokens: 10 },
    ]);

    expect(coverage.totalTokens).toBe(100);
    expect(coverage.coveredTokens).toBe(90);
    expect(coverage.coveragePercent).toBe(90);
    expect(coverage.hasLimitedProviders).toBe(true);
  });

  it("returns 0% coverage when there are no tokens", () => {
    const coverage = calculateConversationBreakdownCoverage([
      { provider_id: "claude", tokens: 0 },
      { provider_id: "codex", tokens: 0 },
    ]);

    expect(coverage.totalTokens).toBe(0);
    expect(coverage.coveredTokens).toBe(0);
    expect(coverage.coveragePercent).toBe(0);
    expect(coverage.hasLimitedProviders).toBe(false);
  });
});
