import { describe, expect, it } from "vitest";
import { calculateModelPrice } from "./calculations";

const oneMillionTokens = 1_000_000;

describe("Grok model pricing", () => {
  it("uses Grok 4.5 pricing for the grok-build-latest alias", () => {
    expect(
      calculateModelPrice(
        "grok-build-latest",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens
      )
    ).toBeCloseTo(8.3);
  });

  it("uses Grok Build 0.1 pricing for its exact model id", () => {
    expect(
      calculateModelPrice(
        "grok-build-0.1",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens
      )
    ).toBeCloseTo(3.2);
  });

  it("does not downgrade a Grok 4.5 model with a build suffix", () => {
    expect(
      calculateModelPrice(
        "grok-4.5-build",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens
      )
    ).toBeCloseTo(8.3);
  });
});
