/**
 * App language → BCP 47 locale for `Intl`.
 *
 * Every formatter in this module takes the **app language** (i18next's
 * `i18n.language`, e.g. `"ko"`), never the OS locale: an `Intl` call without a
 * locale follows the OS, so an English app on a Korean Mac would print Korean
 * dates.
 */

export const LOCALE_BY_LANGUAGE: Readonly<Record<string, string>> = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  "zh-HK": "zh-HK",
  "zh-MO": "zh-MO",
};

const FALLBACK_LOCALE = "en-US";

const supported = new Map<string, boolean>();

const isSupportedLocale = (tag: string): boolean => {
  let ok = supported.get(tag);
  if (ok === undefined) {
    try {
      ok = Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0;
    } catch {
      ok = false;
    }
    supported.set(tag, ok);
  }
  return ok;
};

/** The `Intl` locale for an app language. Unknown or empty → `en-US`. */
export function localeFor(language: string | undefined | null): string {
  if (!language) return FALLBACK_LOCALE;
  const mapped = LOCALE_BY_LANGUAGE[language];
  if (mapped) return mapped;
  return isSupportedLocale(language) ? language : FALLBACK_LOCALE;
}

/** Shown when a value cannot be formatted (NaN, ±Infinity, negative length). */
export const NO_VALUE = "—";
