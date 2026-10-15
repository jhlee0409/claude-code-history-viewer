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
