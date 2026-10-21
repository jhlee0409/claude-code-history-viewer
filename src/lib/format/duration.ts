/**
 * Durations in the app language (plan §4.4).
 *
 * Built from `Intl.NumberFormat` unit styles joined by `Intl.ListFormat`
 * (`type: "unit"`) — the same CLDR data `Intl.DurationFormat` uses, but
 * available in every engine the app runs in (DurationFormat is missing from
 * Node 22 and older WebKit), so tests and app print the same text.
 *
 * Rules: the two largest consecutive units, truncated (`3h 49m`, `13d 16h`,
 * `1m 5s`); under ten seconds one decimal (`2.1s`); under a second
 * milliseconds. Session lengths can stop at minutes (`<1m`).
 */

import { localeFor, NO_VALUE } from "./locale";

export type DurationStyle = "narrow" | "long";
type Unit = "day" | "hour" | "minute" | "second";

const UNIT_MS: Record<Unit, number> = {
  day: 86_400_000,
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
};
const UNITS: readonly Unit[] = ["day", "hour", "minute", "second"];

const numberFormats = new Map<string, Intl.NumberFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

const unitText = (
  value: number,
  unit: Unit | "millisecond",
  locale: string,
  style: DurationStyle,
  fractionDigits = 0,
): string => {
  const key = `${locale}|${unit}|${style}|${fractionDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: style,
      maximumFractionDigits: fractionDigits,
    });
    numberFormats.set(key, format);
  }
  return format.format(value);
};

const joinUnits = (parts: string[], locale: string, style: DurationStyle): string => {
  const key = `${locale}|${style}`;
  let format = listFormats.get(key);
  if (!format) {
    format = new Intl.ListFormat(locale, { type: "unit", style });
    listFormats.set(key, format);
  }
  return format.format(parts);
};

export interface DurationOptions {
  style?: DurationStyle;
  /** `"minute"` hides seconds and shows `<1m` under a minute. */
  smallestUnit?: "second" | "minute";
}

/** A length of time given in milliseconds. */
export function formatDuration(
  ms: number,
  language: string,
  { style = "narrow", smallestUnit = "second" }: DurationOptions = {},
): string {
  if (!Number.isFinite(ms) || ms < 0) return NO_VALUE;
  const locale = localeFor(language);

  if (smallestUnit === "minute" && ms < UNIT_MS.minute) {
    return `<${unitText(1, "minute", locale, style)}`;
  }
  if (ms === 0) return unitText(0, "second", locale, style);
  if (ms < UNIT_MS.second) return unitText(Math.round(ms), "millisecond", locale, style);
  if (ms < 10 * UNIT_MS.second) {
    return unitText(Math.floor(ms / 100) / 10, "second", locale, style, 1);
  }
  if (ms < UNIT_MS.minute) return unitText(Math.floor(ms / UNIT_MS.second), "second", locale, style);

  const allowed = smallestUnit === "minute" ? UNITS.slice(0, 3) : UNITS;
  const largest = allowed.findIndex((unit) => ms >= UNIT_MS[unit]);
  const parts: string[] = [];
  let rest = ms;
  for (const unit of allowed.slice(largest, largest + 2)) {
    const amount = Math.floor(rest / UNIT_MS[unit]);
    rest -= amount * UNIT_MS[unit];
    if (amount > 0) parts.push(unitText(amount, unit, locale, style));
  }
  return joinUnits(parts, locale, style);
}

/** `formatDuration` for a value given in minutes (session lengths). */
export const formatMinutes = (
  minutes: number,
  language: string,
  options: Omit<DurationOptions, "smallestUnit"> = {},
): string => formatDuration(minutes * UNIT_MS.minute, language, { ...options, smallestUnit: "minute" });
