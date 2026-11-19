import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentLanguage, toSupportedLanguage } from "./documentLanguage";

const LANGUAGES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;

describe("toSupportedLanguage", () => {
  it.each([
    ["en", "en"],
    ["en-US", "en"],
    ["ko-KR", "ko"],
    ["ja-JP", "ja"],
    ["zh", "zh-CN"],
    ["zh-CN", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    // Subtags after a singleton (x-, u-, t-) are extensions or private use,
    // not region or script.
    ["zh-CN-x-hk", "zh-CN"],
    ["zh-u-hk", "zh-CN"],
    ["zh-x-tw", "zh-CN"],
    ["zh-Hans-CN-x-hk", "zh-CN"],
    ["zh-Hant-u-nu-hanidec", "zh-TW"],
    ["fr-FR", "en"],
    ["", "en"],
  ])("%s -> %s", (input, expected) => {
    expect(toSupportedLanguage(input)).toBe(expected);
  });
});

describe("applyDocumentLanguage", () => {
  it("writes the supported language to html[lang]", () => {
    const doc = document.implementation.createHTMLDocument("x");
    applyDocumentLanguage("zh-HK", doc);
    expect(doc.documentElement.lang).toBe("zh-TW");
  });
});

/**
 * html[lang] drives the per-language font order and body line height
 * (`:root:lang(...)` in index.css), so it must be right before React renders
 * anything (cold start) and follow every language change.
 */
describe("html[lang] follows the app language", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.lang = "en"; // index.html's static default
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it.each(LANGUAGES)("cold start with stored language %s sets html[lang] when i18n loads, before any render", async (language) => {
    localStorage.setItem("i18nextLng", language);
    await import("./index");
    expect(document.documentElement.lang).toBe(language);
  });

  // BCP 47 tags a browser, the OS or an older build may hand over: i18next
  // must resolve them to the same app language html[lang] gets, so the first
  // render's translations and fonts agree (zh-Hant must not render as en).
  const ALIASES = [
    ["zh-Hant", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-MO", "zh-TW"],
    ["zh-Hant-HK", "zh-TW"],
    ["zh-Hans", "zh-CN"],
    ["zh-CN", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh", "zh-CN"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["en-US", "en"],
  ] as const;

  it.each(ALIASES)("cold start with stored %s resolves i18n and html[lang] to %s before any render", async (stored, expected) => {
    localStorage.setItem("i18nextLng", stored);
    const { default: i18n } = await import("./index");
    expect(i18n.resolvedLanguage).toBe(expected);
    expect(i18n.language).toBe(expected);
    expect(document.documentElement.lang).toBe(expected);
  });

  it.each(ALIASES)("cold start with browser language %s resolves i18n and html[lang] to %s before any render", async (detected, expected) => {
    vi.stubGlobal("navigator", { ...navigator, language: detected, languages: [detected] });
    const { default: i18n } = await import("./index");
    expect(i18n.resolvedLanguage).toBe(expected);
    expect(document.documentElement.lang).toBe(expected);
  });

  it("cold start without a stored language uses the detected browser language", async () => {
    vi.stubGlobal("navigator", { ...navigator, language: "ja-JP", languages: ["ja-JP"] });
    await import("./index");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("switches html[lang] across all five languages and back", async () => {
    localStorage.setItem("i18nextLng", "en");
    const { default: i18n } = await import("./index");
    for (const language of [...LANGUAGES.slice(1), "en"] as const) {
      await i18n.changeLanguage(language);
      expect(document.documentElement.lang).toBe(language);
    }
    await i18n.changeLanguage("zh-HK");
    expect(document.documentElement.lang).toBe("zh-TW");
  });
});
