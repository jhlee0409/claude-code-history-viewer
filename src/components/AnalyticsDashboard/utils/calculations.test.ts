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

  it("applies the long-context tier to Grok 4.3 and its 4.20 variants", () => {
    expect(
      calculateModelPrice(
        "grok-4.3",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_001 },
      ),
    ).toBeCloseTo(7.9);
    expect(
      calculateModelPrice(
        "grok-4.20-0309-reasoning",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_001 },
      ),
    ).toBeCloseTo(7.9);
  });

  it("applies the long-context tier to Grok Build 0.1", () => {
    expect(
      calculateModelPrice(
        "grok-build-0.1",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_001 },
      ),
    ).toBeCloseTo(6.4);
  });
});

describe("provider pricing boundaries", () => {
  it("does not apply a default price to an unknown model", () => {
    expect(
      calculateModelPrice(
        "provider/private-model",
        oneMillionTokens,
        oneMillionTokens,
        oneMillionTokens,
        oneMillionTokens,
      ),
    ).toBeNull();
  });

  it("recognizes canonical provider/model identifiers", () => {
    expect(
      calculateModelPrice(
        "openai/gpt-5.6-terra-2026-01-01",
        oneMillionTokens,
        oneMillionTokens,
        oneMillionTokens,
        oneMillionTokens,
      ),
    ).toBeCloseTo(16.7);
  });

  it("uses the model-specific GPT-4.1 cached-input rate", () => {
    expect(
      calculateModelPrice(
        "gpt-4.1",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(10.5);
  });

  it("recognizes GPT-5 and GPT-5-Codex aliases with cached input pricing", () => {
    expect(
      calculateModelPrice(
        "gpt-5-codex",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(11.375);
    expect(
      calculateModelPrice(
        "copilot/gpt-5-2025-08-07",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(11.375);
  });

  it("supports the OpenAI fast-mode Codex price when encoded in the model id", () => {
    expect(
      calculateModelPrice(
        "gpt-5.3-codex-fast",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(31.85);
  });

  it("uses the reported OpenAI fast/priority service tier for the canonical model id", () => {
    const fast = calculateModelPrice(
      "gpt-5.3-codex",
      oneMillionTokens,
      oneMillionTokens,
      0,
      oneMillionTokens,
      { serviceTier: "fast" },
    );
    const priority = calculateModelPrice(
      "gpt-5.3-codex",
      oneMillionTokens,
      oneMillionTokens,
      0,
      oneMillionTokens,
      { serviceTier: "priority" },
    );

    expect(fast).toBeCloseTo(31.85);
    expect(priority).toBeCloseTo(31.85);
  });

  it("does not turn Cursor subscription usage into a zero-dollar API estimate", () => {
    expect(
      calculateModelPrice(
        "cursor",
        oneMillionTokens,
        oneMillionTokens,
        0,
        0,
        { providerId: "cursor" },
      ),
    ).toBeNull();
  });

  it("does not infer proxy or subscription provider pricing without source cost", () => {
    expect(
      calculateModelPrice(
        "gpt-5.3-codex",
        oneMillionTokens,
        oneMillionTokens,
        0,
        0,
        { providerId: "opencode" },
      ),
    ).toBeNull();
    expect(
      calculateModelPrice(
        "gpt-5.3-codex",
        oneMillionTokens,
        oneMillionTokens,
        0,
        0,
        { providerId: "copilot" },
      ),
    ).toBeNull();
  });

  it("applies GPT-5.6 and GPT-5.4 long-context pricing", () => {
    expect(
      calculateModelPrice(
        "gpt-5.6-terra",
        oneMillionTokens,
        oneMillionTokens,
        oneMillionTokens,
        oneMillionTokens,
        { contextTokens: 272_001 },
      ),
    ).toBeCloseTo(27.4);
    expect(
      calculateModelPrice(
        "gpt-5.4",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 272_001 },
      ),
    ).toBeCloseTo(28);
  });

  it("selects Gemini's long-context tier only above its threshold", () => {
    expect(
      calculateModelPrice(
        "gemini-2.5-pro",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_000 },
      ),
    ).toBeCloseTo(11.375);
    expect(
      calculateModelPrice(
        "gemini-2.5-pro",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_001 },
      ),
    ).toBeCloseTo(17.75);
  });

  it("prices Gemini 3.1 Pro Preview, including custom tools and long context", () => {
    expect(
      calculateModelPrice(
        "gemini-3.1-pro-preview-customtools",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_000 },
      ),
    ).toBeCloseTo(14.2);
    expect(
      calculateModelPrice(
        "gemini-3.1-pro-preview",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
        { contextTokens: 200_001 },
      ),
    ).toBeCloseTo(22.4);
  });

  it("prices Gemini 3.1 Flash Lite text/image/video tokens", () => {
    expect(
      calculateModelPrice(
        "gemini-3.1-flash-lite",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(1.775);
  });

  it("charges separately reported reasoning at the output rate", () => {
    expect(
      calculateModelPrice(
        "gemini-3.1-flash-lite",
        oneMillionTokens,
        oneMillionTokens,
        0,
        0,
        { reasoningTokens: oneMillionTokens },
      ),
    ).toBeCloseTo(3.25);
  });

  it("prices the current Gemini 3.5 Flash generations", () => {
    expect(
      calculateModelPrice(
        "gemini-3.5-flash-preview",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(10.65);
    expect(
      calculateModelPrice(
        "gemini-3.5-flash-lite",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(2.83);
  });

  it("prices the current Gemini 3.6 and 3.7 Flash generations", () => {
    expect(
      calculateModelPrice(
        "gemini-3.7-flash",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(4.575);
    expect(
      calculateModelPrice(
        "gemini-3.6-flash-preview",
        oneMillionTokens,
        oneMillionTokens,
        0,
        oneMillionTokens,
      ),
    ).toBeCloseTo(4.575);
  });

  it("does not apply text pricing to modality-specific models", () => {
    for (const model of [
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-flash-native-audio-preview",
      "gemini-2.5-flash-image",
      "gemini-3.1-pro-preview-image-generation",
      "gemini-omni-flash-preview",
      "gpt-4o-audio-preview",
      "gpt-4o-mini-transcribe",
      "gpt-4o-mini-search-preview",
      "gpt-image-1",
      "sora-2",
      "grok-imagine-video",
    ]) {
      expect(
        calculateModelPrice(
          model,
          oneMillionTokens,
          oneMillionTokens,
          oneMillionTokens,
          oneMillionTokens,
        ),
        model,
      ).toBeNull();
    }
  });

  it("supports both five-minute and one-hour Claude cache writes", () => {
    const fiveMinute = calculateModelPrice(
      "claude-sonnet-5",
      oneMillionTokens,
      oneMillionTokens,
      oneMillionTokens,
      oneMillionTokens,
      { cacheWriteTtl: "5m" },
    );
    const oneHour = calculateModelPrice(
      "claude-sonnet-5",
      oneMillionTokens,
      oneMillionTokens,
      oneMillionTokens,
      oneMillionTokens,
      { cacheWriteTtl: "1h" },
    );

    expect(fiveMinute).toBeCloseTo(14.7);
    expect(oneHour).toBeCloseTo(16.2);
  });
});
