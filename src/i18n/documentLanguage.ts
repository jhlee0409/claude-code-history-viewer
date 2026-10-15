import type { SupportedLanguage } from "./index";

const SUPPORTED: readonly SupportedLanguage[] = ["en", "ko", "ja", "zh-CN", "zh-TW"];

/**
 * The app language for any BCP 47 tag (browser, OS or stored): Chinese splits
 * into Traditional (TW / HK / MO / Hant) and Simplified (everything else),
 * other languages match on the primary subtag, unknown ones fall back to
 * English.
 */
export function toSupportedLanguage(lang: string): SupportedLanguage {
  const [primary = "", ...rest] = lang.toLowerCase().split(/[-_]/);
  if (primary === "zh") {
    return rest.some((part) => ["tw", "hk", "mo", "hant"].includes(part)) ? "zh-TW" : "zh-CN";
  }
  return SUPPORTED.find((supported) => supported === primary) ?? "en";
}

/**
 * Write the app language to `html[lang]`. The per-language font order and
 * body line height in index.css (`:root:lang(...)`) key on it, and so do the
 * Han glyph shapes WebKit picks for Japanese vs Simplified vs Traditional
 * Chinese.
 */
export function applyDocumentLanguage(lang: string, doc: Document = document): void {
  doc.documentElement.lang = toSupportedLanguage(lang);
}
