/**
 * Dates and times in the app language (plan §4.4).
 *
 * Two everyday styles — time (`6:44 AM`) and date-time (`Jun 30, 6:44 AM`);
 * seconds only in the full form for tooltips. Every function takes the app
 * language; none reads the OS locale. `timeZone` defaults to the system zone
 * (tests pin it).
 */

// The default i18next instance — the one `src/i18n` initialises. Importing
// it (not `@/i18n`) keeps this module usable where tests mock react-i18next.
import i18n from "i18next";
import { localeFor, NO_VALUE } from "./locale";
import { isDayKey, localDayKey, shiftDayKey, type DayKey } from "./localDay";

export type DateInput = string | number | Date;

export interface ZoneOption {
  /** IANA zone; default = the system zone. */
  timeZone?: string;
}

export interface NowOption extends ZoneOption {
  /** Reference "now" in epoch ms (tests). */
  now?: number;
}

export type DateStyle = "short" | "medium" | "long" | "weekday" | "numeric";

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: "short", day: "numeric" },
  medium: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  weekday: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  numeric: { month: "numeric", day: "numeric" },
};

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

const cache = new Map<string, Intl.DateTimeFormat>();

const dateFormat = (
  language: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string | undefined,
): Intl.DateTimeFormat => {
  const locale = localeFor(language);
  const key = `${locale}|${timeZone ?? ""}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, timeZone ? { ...options, timeZone } : options);
    cache.set(key, format);
  }
  return format;
};

const toDate = (value: DateInput): Date | null => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const unreadable = (value: DateInput): string => (typeof value === "string" ? value : NO_VALUE);

/** Clock time: `6:44 AM` · ko `오전 6:44` · ja `6:44`. */
export function formatTime(value: DateInput, language: string, { timeZone }: ZoneOption = {}): string {
  const date = toDate(value);
  return date ? dateFormat(language, TIME, timeZone).format(date) : unreadable(value);
}

/**
 * Date and clock time: `Jun 30, 6:44 AM`. The year is added when it is not
 * the current one (`Jun 30, 2026, 6:44 AM`).
 */
export function formatDateTime(
  value: DateInput,
  language: string,
  { timeZone, now = Date.now(), year = "auto" }: NowOption & { year?: "auto" | "always" } = {},
): string {
  const date = toDate(value);
  if (!date) return unreadable(value);
  const showYear =
    year === "always" || localDayKey(date, timeZone)?.slice(0, 4) !== localDayKey(now, timeZone)?.slice(0, 4);
  const options: Intl.DateTimeFormatOptions = showYear
    ? { year: "numeric", ...DATE_STYLES.short, ...TIME }
    : { ...DATE_STYLES.short, ...TIME };
  return dateFormat(language, options, timeZone).format(date);
}

/** Full date and time with seconds — for tooltips and detail rows. */
export function formatDateTimeFull(
  value: DateInput,
  language: string,
  { timeZone }: ZoneOption = {},
): string {
  const date = toDate(value);
  return date
    ? dateFormat(language, { dateStyle: "long", timeStyle: "medium" }, timeZone).format(date)
    : unreadable(value);
}

/** A date without time. */
export function formatDate(
  value: DateInput,
  language: string,
  { style = "medium", timeZone }: ZoneOption & { style?: DateStyle } = {},
): string {
  const date = toDate(value);
  return date ? dateFormat(language, DATE_STYLES[style], timeZone).format(date) : unreadable(value);
}

const dayKeyDate = (key: DayKey): Date | null => {
  if (!isDayKey(key)) return null;
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

/**
 * A calendar date key (`YYYY-MM-DD`) as text. Formatted in UTC so the key's
 * own date is shown — `new Date("2026-06-20")` is UTC midnight, which is the
 * 19th west of Greenwich.
 */
export function formatDayKey(
  key: DayKey,
  language: string,
  { style = "medium" }: { style?: DateStyle | "day" | "weekdayShort" } = {},
): string {
  const date = dayKeyDate(key);
  if (!date) return key;
  const options: Intl.DateTimeFormatOptions =
    style === "day" ? { day: "numeric" } : style === "weekdayShort" ? { weekday: "short" } : DATE_STYLES[style];
  return dateFormat(language, options, "UTC").format(date);
}

/** Weekday (0 = Sunday) of a calendar date key. */
export const dayKeyWeekday = (key: DayKey): number | null => dayKeyDate(key)?.getUTCDay() ?? null;

/** A month (`YYYY-MM`): `Jun 2026` · ko `2026년 6월`. */
export function formatMonth(yearMonth: string, language: string): string {
  const date = dayKeyDate(`${yearMonth}-01`);
  return date ? dateFormat(language, { year: "numeric", month: "short" }, "UTC").format(date) : yearMonth;
}

/** Short month name for a 0-based month index: `Jun` · ko `6월`. */
export function formatMonthName(monthIndex: number, language: string): string {
  return dateFormat(language, { month: "short" }, "UTC").format(new Date(Date.UTC(2000, monthIndex, 1)));
}

const MINUTE_MS = 60_000;

/**
 * Relative age for list rows: `just now`, `5 minutes ago`, `3 days ago`;
 * after a week a short date (`Jun 1`).
 */
export function formatRelative(value: DateInput, language: string, { now = Date.now(), timeZone }: NowOption = {}): string {
  const date = toDate(value);
  if (!date) return unreadable(value);
  const diffMs = now - date.getTime();
  const minutes = Math.floor(diffMs / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const lng = language;
  if (minutes < 1) return i18n.t("common.time.justNow", { lng });
  if (minutes < 60) return i18n.t("common.time.minutesAgo", { count: minutes, lng });
  if (hours < 24) return i18n.t("common.time.hoursAgo", { count: hours, lng });
  if (days < 7) return i18n.t("common.time.daysAgo", { count: days, lng });
  return formatDate(date, language, { style: "short", timeZone });
}

/** Transcript day divider: `Today`, `Yesterday` or `Friday, June 26, 2026`. */
export function formatDateDivider(
  value: DateInput,
  language: string,
  { now = Date.now(), timeZone }: NowOption = {},
): string {
  const date = toDate(value);
  if (!date) return unreadable(value);
  const day = localDayKey(date, timeZone);
  const today = localDayKey(now, timeZone);
  if (day && today) {
    if (day === today) return i18n.t("time.today", { lng: language });
    if (day === shiftDayKey(today, -1)) return i18n.t("time.yesterday", { lng: language });
  }
  return formatDate(date, language, { style: "weekday", timeZone });
}

/** Whether two instants fall on the same local calendar day. */
export function isSameLocalDay(a: DateInput, b: DateInput, timeZone?: string): boolean {
  const left = toDate(a);
  const right = toDate(b);
  if (!left || !right) return false;
  return localDayKey(left, timeZone) === localDayKey(right, timeZone);
}
