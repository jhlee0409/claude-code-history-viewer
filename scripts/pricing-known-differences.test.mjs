import { describe, expect, it } from "vitest";
import { splitKnownDifferences } from "./pricing-known-differences.mjs";

const known = [
  { model: "gpt-5.6-sol", field: "input", feed: "openrouter", feedValue: 2, reason: "Batch row", verifiedAt: "2026-10-01" },
  { model: "claude-mythos-preview", field: "deprecation", feed: "litellm", feedValue: "2026-06-09", reason: "Deprecation date, not shutdown", verifiedAt: "2026-10-01" },
];

const result = (mismatches, deprecations = []) => ({ mismatches, deprecations, unmatched: [], newModels: [] });

describe("splitKnownDifferences", () => {
  it("moves a mismatch whose feed value matches a known difference out of the findings", () => {
    const out = splitKnownDifferences(
      result([{ key: "gpt-5.6-sol", field: "input", ours: 4, theirs: 2, source: "openrouter:openai/gpt-5.6-sol" }]),
      known,
    );
    expect(out.mismatches).toEqual([]);
    expect(out.acknowledged).toHaveLength(1);
    expect(out.acknowledged[0].reason).toBe("Batch row");
  });

  it("keeps the mismatch when the feed value changed", () => {
    const out = splitKnownDifferences(
      result([{ key: "gpt-5.6-sol", field: "input", ours: 4, theirs: 3, source: "openrouter:openai/gpt-5.6-sol" }]),
      known,
    );
    expect(out.mismatches).toHaveLength(1);
    expect(out.acknowledged).toEqual([]);
  });

  it("keeps the mismatch when it comes from a different feed or field", () => {
    const out = splitKnownDifferences(
      result([
        { key: "gpt-5.6-sol", field: "input", ours: 4, theirs: 2, source: "litellm:gpt-5.6-sol" },
        { key: "gpt-5.6-sol", field: "output", ours: 20, theirs: 2, source: "openrouter:openai/gpt-5.6-sol" },
      ]),
      known,
    );
    expect(out.mismatches).toHaveLength(2);
  });

  it("acknowledges a known deprecation signal only for the recorded date", () => {
    const same = splitKnownDifferences(
      result([], [{ key: "claude-mythos-preview", ours: null, theirs: "2026-06-09", source: "litellm:claude-mythos-preview" }]),
      known,
    );
    expect(same.deprecations).toEqual([]);
    const moved = splitKnownDifferences(
      result([], [{ key: "claude-mythos-preview", ours: null, theirs: "2026-12-01", source: "litellm:claude-mythos-preview" }]),
      known,
    );
    expect(moved.deprecations).toHaveLength(1);
  });
});
