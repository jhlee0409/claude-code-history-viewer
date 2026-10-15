// Localized labels for selectors, read from the checkout being captured, so a
// step can find "Analytics" by its accessible name in any of the 5 locales and
// a base ref's build is driven with that build's own strings.

import fs from "node:fs";
import path from "node:path";

export const SUPPORTED_LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"];

/** BCP 47 tag handed to the browser for each app locale. */
export const BROWSER_LOCALE = { en: "en-US", ko: "ko-KR", ja: "ja-JP", "zh-CN": "zh-CN", "zh-TW": "zh-TW" };

export function loadTranslator(appDir, locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`unsupported locale "${locale}" (expected one of ${SUPPORTED_LOCALES.join(", ")})`);
  }
  const dir = path.join(appDir, "src", "i18n", "locales", locale);
  const strings = {};
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    Object.assign(strings, JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  }
  return (key) => {
    const value = strings[key];
    if (typeof value !== "string") throw new Error(`i18n key "${key}" missing for locale ${locale} in ${dir}`);
    return value;
  };
}
