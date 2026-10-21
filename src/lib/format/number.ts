/**
 * Numbers, token counts, costs, percentages and byte sizes in the app
 * language (plan §4.4).
 *
 * One style per magnitude:
 * - counts (messages, sessions, tool uses) — always grouped: `1,369`.
 * - token amounts — grouped below 10K, compact from 10K up: `9,999` · `12.3K`
 *   · `59.4M` (ko `5940만`). Compact keeps at most one decimal and three
 *   significant digits, whichever is shorter, and never breaks across lines
 *   (a CJK suffix is joined to its numeral, see `WORD_JOINER`).
 * - cost — US dollars, always two decimals; a positive amount under a cent is
 *   `<$0.01`, never `$0.00`.
 * - percent — whole numbers; a non-zero share never rounds to `0%` (`<1%`) and
 *   a partial one never to `100%` (`>99%`).
 */

import { localeFor, NO_VALUE } from "./locale";

export const COMPACT_FROM = 10_000;

export type NumberStyle = "auto" | "grouped" | "compact";

const cache = new Map<string, Intl.NumberFormat>();

const numberFormat = (locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    cache.set(key, format);
  }
  return format;
};

const GROUPED: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
// `roundingPriority` (ES2023) is missing from the TS lib in use; engines
// without it ignore the key and fall back to three significant digits.
const COMPACT = {
  notation: "compact",
  maximumFractionDigits: 1,
  maximumSignificantDigits: 3,
  roundingPriority: "lessPrecision",
} as Intl.NumberFormatOptions;

/**
 * U+2060 WORD JOINER: invisible, no width, and no line break on either side.
 *
 * A compact number is one atom wherever it is rendered. Latin suffixes (`K`,
 * `M`, `B`, `T`) are letters, and Unicode line breaking (UAX #14) never breaks
 * between a digit and a letter. CJK suffixes (`万` `億` `亿` `萬` `兆` `万亿`,
 * `천` `만` `억` `조`) are ideographs and Hangul syllables, which may break from
 * a digit and from each other: in a narrow box `1120万` wrapped as `1120` /
 * `万`. So the formatter joins a CJK suffix to its numeral (and its own
 * characters to each other), never at either end of the text, where a joiner
 * would also glue the number to the space beside it.
 *
 * A numeric display copies the number without it (`copyNumbersPlain`), so
 * pasted text reads `1120万` and matches a search. It is a default-ignorable
 * format character, which screen readers do not speak.
 */
const WORD_JOINER = "\u2060";
const BREAKABLE_SUFFIX = /[\p{Script=Han}\p{Script=Hangul}]/u;

function joinCompactParts(parts: Intl.NumberFormatPart[]): string {
  return parts
    .map((part, i) => {
      if (part.type !== "compact" || !BREAKABLE_SUFFIX.test(part.value)) return part.value;
      const before = i > 0 ? WORD_JOINER : "";
      const after = i < parts.length - 1 ? WORD_JOINER : "";
      return before + Array.from(part.value).join(WORD_JOINER) + after;
    })
    .join("");
}

/** A compact number as `joinCompactParts` writes it: a numeral, joiner + suffix character once or more, and a joiner before any part after it. */
const JOINED_COMPACT = /\d(?:\u2060[\p{Script=Han}\p{Script=Hangul}])+\u2060?/gu;

/**
 * `text` without the word joiners `formatNumber` puts into compact numbers,
 * i.e. the text `Intl` writes (`1120⁠万` → `1120万`, `1.2⁠万⁠亿` → `1.2万亿`).
 * Only a joiner inside such a number goes; any other U+2060 stays. For
 * copying a numeric display (`copyNumbersPlain`), never for recorded text.
 */
export const withoutNumberJoiners = (text: string): string =>
  text.replace(JOINED_COMPACT, (number) => number.split(WORD_JOINER).join(""));

/** A number in the app language. `auto` = grouped below 10K, compact above. */
export function formatNumber(
  value: number,
  language: string,
  { style = "auto" }: { style?: NumberStyle } = {},
): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  const locale = localeFor(language);
  const compact = style === "compact" || (style === "auto" && Math.abs(value) >= COMPACT_FROM);
  if (!compact) return numberFormat(locale, GROUPED).format(value);
  return joinCompactParts(numberFormat(locale, COMPACT).formatToParts(value));
}

/** A count of things (messages, sessions, uses): always grouped. */
export const formatCount = (value: number, language: string): string =>
  formatNumber(value, language, { style: "grouped" });

/** A token amount: grouped below 10K, compact from 10K. */
export const formatTokens = (value: number, language: string): string =>
  formatNumber(value, language, { style: "auto" });

/** A number with a fixed number of decimals (`1.0`, `2.10`). */
export function formatDecimal(value: number, language: string, fractionDigits: number): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  return numberFormat(localeFor(language), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

const USD: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

/** A cost in US dollars: `$34.10`, `<$0.01`, `$0.00`. */
export function formatCost(usd: number, language: string): string {
  if (!Number.isFinite(usd)) return NO_VALUE;
  const format = numberFormat(localeFor(language), USD);
  if (usd > 0 && usd < 0.01) return `<${format.format(0.01)}`;
  return format.format(usd);
}

const PERCENT: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 0 };

/** A share given as a ratio (0.453 → `45%`). */
export function formatPercent(ratio: number, language: string): string {
  if (!Number.isFinite(ratio)) return NO_VALUE;
  const format = numberFormat(localeFor(language), PERCENT);
  if (ratio > 0 && ratio < 0.005) return `<${format.format(0.01)}`;
  if (ratio >= 0.995 && ratio < 1) return `>${format.format(0.99)}`;
  return format.format(ratio);
}

export type ChangeDirection = "up" | "down" | "flat" | "new";

const SIGNED_PERCENT: Intl.NumberFormatOptions = {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
};

/**
 * The whole-percent change from `previous` to `current`, against
 * `|previous|` (`100 → 125` is `25`), never `-0`. The number `formatChange`
 * shows, for callers that compare it (trend chips); a zero `previous` is the
 * caller's case (`new`).
 */
export const changePercent = (previous: number, current: number): number =>
  Math.round(((current - previous) / Math.abs(previous)) * 100) + 0;

/**
 * Change from `previous` to `current`: a direction and a signed whole
 * percentage. No good/bad judgement — the caller decides colour (none).
 * From zero to something is `new` with no percentage.
 */
export function formatChange(
  previous: number,
  current: number,
  language: string,
): { direction: ChangeDirection; text: string } {
  const format = numberFormat(localeFor(language), SIGNED_PERCENT);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    return { direction: "flat", text: NO_VALUE };
  }
  if (previous === 0) {
    return current === 0 ? { direction: "flat", text: format.format(0) } : { direction: "new", text: "" };
  }
  const rounded = changePercent(previous, current);
  const direction: ChangeDirection = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  return { direction, text: format.format(rounded / 100) };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** A byte size in binary steps with one decimal (`1.5 MB`). */
export function formatBytes(bytes: number, language: string): string {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  if (bytes < 0) return `-${formatBytes(-bytes, language)}`;
  if (bytes < 1) return "0 B";
  const step = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(step)), BYTE_UNITS.length - 1);
  return `${formatDecimal(bytes / step ** i, language, 1)} ${BYTE_UNITS[i]}`;
}
