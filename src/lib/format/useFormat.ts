/**
 * Formatters bound to the app language.
 *
 * Components use `useFormat()` (re-renders on a language change); code outside
 * React uses `appFormat()`, which reads the current `i18n.language` on each
 * call. Both return the same shape as `formatterFor(language)`.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
// The default i18next instance — the one `src/i18n` initialises. Importing
// it (not `@/i18n`) keeps this module usable where tests mock react-i18next.
import i18n from "i18next";
import {
  formatDate,
  formatDateDivider,
  formatDateTime,
  formatDateTimeFull,
  formatDayKey,
  formatMonth,
  formatMonthName,
  formatRelative,
  formatTime,
  type DateInput,
  type DateStyle,
  type NowOption,
  type ZoneOption,
} from "./date";
import { formatDuration, formatMinutes, type DurationOptions } from "./duration";
import {
  formatBytes,
  formatChange,
  formatCost,
  formatCount,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatTokens,
  type NumberStyle,
} from "./number";

export function formatterFor(language: string) {
  return {
    language,
    number: (value: number, style?: NumberStyle) => formatNumber(value, language, { style }),
    count: (value: number) => formatCount(value, language),
    tokens: (value: number) => formatTokens(value, language),
    decimal: (value: number, fractionDigits: number) => formatDecimal(value, language, fractionDigits),
    cost: (usd: number) => formatCost(usd, language),
    percent: (ratio: number) => formatPercent(ratio, language),
    change: (previous: number, current: number) => formatChange(previous, current, language),
    bytes: (bytes: number) => formatBytes(bytes, language),
    duration: (ms: number, options?: DurationOptions) => formatDuration(ms, language, options),
    minutes: (minutes: number, options?: Omit<DurationOptions, "smallestUnit">) =>
      formatMinutes(minutes, language, options),
    time: (value: DateInput, options?: ZoneOption) => formatTime(value, language, options),
    dateTime: (value: DateInput, options?: NowOption & { year?: "auto" | "always" }) =>
      formatDateTime(value, language, options),
    dateTimeFull: (value: DateInput, options?: ZoneOption) => formatDateTimeFull(value, language, options),
    date: (value: DateInput, style?: DateStyle, options?: ZoneOption) =>
      formatDate(value, language, { ...options, style }),
    dayKey: (key: string, style?: DateStyle | "day" | "weekdayShort") => formatDayKey(key, language, { style }),
    month: (yearMonth: string) => formatMonth(yearMonth, language),
    monthName: (monthIndex: number) => formatMonthName(monthIndex, language),
    relative: (value: DateInput, options?: NowOption) => formatRelative(value, language, options),
    dateDivider: (value: DateInput, options?: NowOption) => formatDateDivider(value, language, options),
  };
}

export type Formatter = ReturnType<typeof formatterFor>;

const currentLanguage = (): string => i18n.language || "en";

/** Formatters for the current app language (outside React). */
export const appFormat = (): Formatter => formatterFor(currentLanguage());

/** Formatters for the current app language; updates when it changes. */
export function useFormat(): Formatter {
  const { i18n: instance } = useTranslation();
  // Test mocks of react-i18next may omit `i18n`.
  const language = instance?.language || i18n.language || "en";
  return useMemo(() => formatterFor(language), [language]);
}
