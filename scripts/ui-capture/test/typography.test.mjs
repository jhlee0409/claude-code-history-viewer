// Typography checks (plan T4 / §9b C5): type steps × font scale, per-language
// font order and body line height, html[lang], minimum font size.

import { describe, expect, it } from "vitest";
import { BODY_LINE_HEIGHT, FONT_STACKS, TYPE_STEPS, checkTypography, parseFontFamily } from "../lib/typography.mjs";
import { SUPPORTED_LOCALES } from "../lib/i18n.mjs";
import { expandScenarios } from "../scenarios.mjs";

const stepsAt = (scale, override = {}) =>
  Object.fromEntries(
    Object.entries(TYPE_STEPS).map(([step, base]) => {
      const fontSize = Math.round(base * scale * 100) / 100;
      const ratio = step === "body" ? 1.7 : 1.4;
      return [step, { fontSize, lineHeight: `${fontSize * ratio}px`, ...override[step] }];
    }),
  );

const sample = (overrides = {}) => ({
  lang: "ko",
  appFontScale: 1,
  bodyFontFamily: `"IBM Plex Sans", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`,
  steps: stepsAt(1),
  used: { caption: [12], list: [13], body: [15] },
  ...overrides,
});

describe("type steps and font stacks", () => {
  it("are the decision.html scale and per-language stacks", () => {
    expect(TYPE_STEPS).toEqual({ caption: 12, list: 13, body: 15, code: 13, title: 17, lg: 18, xl: 20, "2xl": 24 });
    expect(Object.keys(FONT_STACKS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const stack of Object.values(FONT_STACKS)) expect(stack[0]).toBe("IBM Plex Sans");
    expect(BODY_LINE_HEIGHT).toEqual({ en: 1.55, ko: 1.7, ja: 1.7, "zh-CN": 1.7, "zh-TW": 1.7 });
  });

  it("parses a computed font-family list", () => {
    expect(parseFontFamily(`"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif`)).toEqual([
      "IBM Plex Sans",
      "-apple-system",
      "Segoe UI",
      "sans-serif",
    ]);
  });
});

describe("checkTypography", () => {
  it("accepts a correct ko page at 100%", () => {
    expect(checkTypography(sample(), { locale: "ko", scalePercent: 100, minFontPx: 12 })).toEqual([]);
  });

  it("rejects a min font below 12px at 100%", () => {
    expect(checkTypography(sample(), { locale: "ko", scalePercent: 100, minFontPx: 11 })).toEqual([
      "min font 11px < 12px at 100%",
    ]);
  });

  it("checks each step = base × scale ±0.5px at 90% and 110%", () => {
    for (const scale of [0.9, 1.1]) {
      const t = sample({ appFontScale: scale, steps: stepsAt(scale), used: {} });
      expect(checkTypography(t, { locale: "ko", scalePercent: Math.round(scale * 100), minFontPx: 12 * scale })).toEqual([]);
    }
    const off = sample({ appFontScale: 1.1, steps: stepsAt(1.1, { caption: { fontSize: 12, lineHeight: "16.8px" } }), used: {} });
    expect(checkTypography(off, { locale: "ko", scalePercent: 110, minFontPx: 13.2 })).toEqual([
      "step caption 12px, expected 13.2px (12 × 1.1)",
    ]);
  });

  it("rejects a rendered element whose step class does not give the step size", () => {
    const t = sample({ used: { caption: [12, 15] } });
    expect(checkTypography(t, { locale: "ko", scalePercent: 100, minFontPx: 12 })).toEqual([
      "text-caption rendered at 15px, expected 12px",
    ]);
  });

  it("rejects a wrong html[lang], app font scale, font order or body line height", () => {
    const t = sample({
      lang: "en",
      appFontScale: 0.9,
      bodyFontFamily: `"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif`,
      steps: stepsAt(1, { body: { fontSize: 15, lineHeight: "23.25px" } }),
    });
    expect(checkTypography(t, { locale: "ko", scalePercent: 100, minFontPx: 12 })).toEqual([
      'html[lang] "en", expected "ko"',
      "--app-font-scale 0.9, expected 1",
      'font-family "IBM Plex Sans, -apple-system, Segoe UI, sans-serif", expected "IBM Plex Sans, Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, Noto Sans CJK KR, sans-serif"',
      "body line height 1.55, expected 1.7",
    ]);
  });
});

describe("scale scenarios", () => {
  it("declares transcript and analytics at 90% and 110% (1440x900 light)", () => {
    const scaled = expandScenarios().filter((s) => s.screen.fontScalePercent);
    expect(scaled.map((s) => s.id).sort()).toEqual([
      "analytics-scale110--1440x900--light",
      "analytics-scale90--1440x900--light",
      "transcript-scale110--1440x900--light",
      "transcript-scale90--1440x900--light",
    ]);
    for (const s of scaled) {
      expect(s.screen.steps[0]).toEqual({ do: "fontScale", percent: s.screen.fontScalePercent });
    }
  });
});

describe("browser text size (--font-scale, plan I0)", () => {
  it("expects every step at base × root scale while the app's own scale stays 1", () => {
    const typography = sample({ steps: stepsAt(1.25), used: { list: [16.25] } });
    expect(checkTypography(typography, { locale: "ko", scalePercent: 100, rootScale: 1.25, minFontPx: 15 })).toEqual([]);
  });

  it("still fails a step that did not follow the root size", () => {
    const typography = sample({ steps: stepsAt(1.25, { list: { fontSize: 13, lineHeight: "18px" } }) });
    const problems = checkTypography(typography, { locale: "ko", scalePercent: 100, rootScale: 1.25, minFontPx: 15 });
    expect(problems.some((p) => p.startsWith("step list 13px, expected 16.25px"))).toBe(true);
  });
});
