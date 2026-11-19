/**
 * Local calendar days (plan §4.8).
 *
 * `localDayKey` puts an instant on its local date; `localDayIntervals` turns
 * local dates into UTC `[start, end)` millisecond edges so a backend can sum
 * by them without a time-zone library. Pure functions over
 * `Intl.DateTimeFormat#formatToParts`; no dependency.
 *
 * - A local day starts at the first instant whose wall time is at or after
 *   that date's 00:00 and ends where the next date starts: contiguous, never
 *   overlapping. DST days are 23 or 25 hours (23.5 / 24.5 on Lord Howe); a
 *   date that never happened (Pacific/Apia 2011-12-30) is zero-length.
 * - A wall time inside a DST gap resolves to the first instant after the gap;
 *   inside a fold, to the earlier occurrence.
 *
 * API-compatible with AN0a's `src/lib/usageBreakdown/localDayIntervals.ts`
 * (#685), which re-exports from here (ADR 0002 §2).
 */

/** Local calendar date, `YYYY-MM-DD`. */
export type DayKey = string;

export interface LocalDayInterval {
  key: DayKey;
  start_utc: number;
  end_utc: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Every real UTC offset lies within ±15 h. */
const SEARCH_RADIUS_MS = 15 * HOUR_MS;
const OFFSET_PROBES_MS = [-36, -24, -12, 0, 12, 24, 36].map((h) => h * HOUR_MS);
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The zone the OS (and so the WebView) runs in. */
export const systemTimeZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

const partFormatters = new Map<string, Intl.DateTimeFormat>();

const partFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let format = partFormatters.get(timeZone);
  if (!format) {
    // Throws RangeError for an unknown zone.
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(timeZone, format);
  }
  return format;
};

const parseDayKey = (key: DayKey): [number, number, number] => {
  const match = DAY_KEY_RE.exec(key);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      year >= 1000 &&
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    ) {
      return [year, month, day];
    }
  }
  throw new RangeError(`Invalid day key: ${key}`);
};

/** `true` when `key` is a real `YYYY-MM-DD` date. */
export const isDayKey = (key: string): boolean => {
  try {
    parseDayKey(key);
    return true;
  } catch {
    return false;
  }
};

const toDayKey = (year: number, month: number, day: number): DayKey =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Local wall time of `utcMs` read as if it were a UTC instant. */
const naiveLocalMs = (utcMs: number, timeZone: string): number => {
  const parts = partFormatter(timeZone).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const millisecond = ((utcMs % 1000) + 1000) % 1000;
  return Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
    millisecond,
  );
};

const toMs = (value: number | string | Date): number =>
  typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(value);

/**
 * The local date of an instant; `null` when the timestamp is unreadable.
 * Without `timeZone` it reads the system zone through `Date`'s local getters
 * (same zone as `Intl`'s default, much cheaper — used per message).
 */
export function localDayKey(value: number | string | Date, timeZone?: string): DayKey | null {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return null;
  if (timeZone === undefined) {
    const local = new Date(ms);
    return toDayKey(local.getFullYear(), local.getMonth() + 1, local.getDate());
  }
  const naive = new Date(naiveLocalMs(ms, timeZone));
  return toDayKey(naive.getUTCFullYear(), naive.getUTCMonth() + 1, naive.getUTCDate());
}

/**
 * Local wall-clock time `HH:MM:SS` (24 h, no locale) — for files the app
 * writes (exports), where the text must not depend on any language.
 */
export function localTimeOfDay(value: number | string | Date): string | null {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`;
}

/** Local wall time as numeric fields. */
export interface LocalWallTime {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/** The local wall-clock fields of an instant in `timeZone`. */
export function localWallTime(utcMs: number, timeZone: string): LocalWallTime {
  const naive = new Date(naiveLocalMs(utcMs, timeZone));
  return {
    hour: naive.getUTCHours(),
    minute: naive.getUTCMinutes(),
    second: naive.getUTCSeconds(),
    millisecond: naive.getUTCMilliseconds(),
  };
}

/** `key` moved by whole calendar days. */
export function shiftDayKey(key: DayKey, days: number): DayKey {
  const [year, month, day] = parseDayKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return toDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Every date from `from` to `to`, inclusive. */
export function dayKeysBetween(from: DayKey, to: DayKey): DayKey[] {
  const [fy, fm, fd] = parseDayKey(from);
  const [ty, tm, td] = parseDayKey(to);
  const count = (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS + 1;
  if (count < 1) throw new RangeError(`Day range ends before it starts: ${from}..${to}`);
  return Array.from({ length: count }, (_, i) => shiftDayKey(from, i));
}

/** The same number of local dates immediately before `range`. */
export function previousPeriod(range: { from: DayKey; to: DayKey }): { from: DayKey; to: DayKey } {
  const length = dayKeysBetween(range.from, range.to).length;
  return { from: shiftDayKey(range.from, -length), to: shiftDayKey(range.from, -1) };
}

/** The instant `dayKey` shows `hour:minute` in `timeZone` (gap → after, fold → earlier). */
export function resolveLocalWallTime(
  dayKey: DayKey,
  wall: { hour: number; minute: number; second?: number; millisecond?: number },
  timeZone: string,
): number {
  const [year, month, day] = parseDayKey(dayKey);
  const target = Date.UTC(year, month - 1, day, wall.hour, wall.minute, wall.second ?? 0, wall.millisecond ?? 0);

  let earliest: number | null = null;
  for (const probe of OFFSET_PROBES_MS) {
    const at = target + probe;
    const candidate = target - (naiveLocalMs(at, timeZone) - at);
    if (naiveLocalMs(candidate, timeZone) === target && (earliest === null || candidate < earliest)) {
      earliest = candidate;
    }
  }
  if (earliest !== null) return earliest;

  // Gap: this wall time never shows. Binary-search the first instant past it.
  let lo = target - SEARCH_RADIUS_MS;
  let hi = target + SEARCH_RADIUS_MS;
  if (naiveLocalMs(lo, timeZone) >= target || naiveLocalMs(hi, timeZone) < target) {
    throw new RangeError(`Cannot resolve ${dayKey} ${wall.hour}:${wall.minute} in ${timeZone}`);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (naiveLocalMs(mid, timeZone) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** First instant of a local date. */
export const startOfLocalDay = (dayKey: DayKey, timeZone: string = systemTimeZone()): number =>
  resolveLocalWallTime(dayKey, { hour: 0, minute: 0 }, timeZone);

/** One `[start, end)` interval per local date from `from` to `to`, inclusive. */
export function localDayIntervals(
  range: { from: DayKey; to: DayKey },
  timeZone: string = systemTimeZone(),
): LocalDayInterval[] {
  const keys = dayKeysBetween(range.from, range.to);
  const edges = [...keys, shiftDayKey(range.to, 1)].map((key) => startOfLocalDay(key, timeZone));
  return keys.map((key, i) => {
    const start = edges[i] as number;
    const end = edges[i + 1] as number;
    if (end < start) throw new RangeError(`Local date ${key} in ${timeZone} ends before it starts`);
    return { key, start_utc: start, end_utc: end };
  });
}
