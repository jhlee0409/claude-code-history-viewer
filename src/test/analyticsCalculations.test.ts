import { describe, expect, it } from "vitest";
import {
  calculateModelPrice,
  hasExplicitModelPricing,
} from "../components/AnalyticsDashboard/utils/calculations";

const ONE_MILLION_TOKENS = 1_000_000;

describe("MiniMax analytics pricing", () => {
  it("recognizes both explicit model pricing entries", () => {
    expect(hasExplicitModelPricing("MiniMax-M3")).toBe(true);
    expect(hasExplicitModelPricing("MiniMax-M2.7")).toBe(true);
  });

  it("calculates MiniMax-M3 pricing without an unavailable cache-write rate", () => {
    // 0.30 input + 1.20 output + 0.06 cache read: the published effective
    // rate after MiniMax's permanent 50% discount, not the struck-through list price.
    expect(
      calculateModelPrice(
        "MiniMax-M3",
        ONE_MILLION_TOKENS,
        ONE_MILLION_TOKENS,
        ONE_MILLION_TOKENS,
        ONE_MILLION_TOKENS
      )
    ).toBeCloseTo(1.56);
  });

  it("calculates MiniMax-M2.7 pricing with cache read and write rates", () => {
    expect(
      calculateModelPrice(
        "MiniMax-M2.7",
        ONE_MILLION_TOKENS,
        ONE_MILLION_TOKENS,
        ONE_MILLION_TOKENS,
        ONE_MILLION_TOKENS
      )
    ).toBeCloseTo(1.935);
  });
});
