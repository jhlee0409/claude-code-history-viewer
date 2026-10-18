/**
 * Local-day `[start, end)` intervals for the usage breakdown (ADR 0002 §2–3).
 *
 * The frontend turns local calendar dates into UTC epoch-millisecond edges;
 * the backend only compares milliseconds. Pure functions over
 * `Intl.DateTimeFormat` — no time-zone dependency.
 *
 * Rules:
 * - A local day starts at the first instant whose local wall time is at or
 *   after that date's 00:00 and ends where the next date starts, so the
 *   intervals are contiguous and never overlap. A date that does not exist
 *   (Pacific/Apia 2011-12-30) is a zero-length interval.
 * - A wall-clock time inside a DST gap resolves to the first instant after
 *   the gap; inside a fold, to the earlier occurrence.
 *
 * F3b moves the canonical copy to `src/lib/format/`; this module then
 * re-exports it.
 */

import { MAX_USAGE_INTERVALS, type UsageInterval } from "@/types/usageBreakdown";

/** Local calendar date, `YYYY-MM-DD`. */
export type DayKey = string;

export interface LocalWallTime {
  hour: number;
  minute: number;
  second?: number;
  millisecond?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Every real UTC offset lies within ±15 h, so ±15 h brackets any local time. */
const SEARCH_RADIUS_MS = 15 * HOUR_MS;
/** Instants around a naive time whose offsets may apply to it. */
const OFFSET_PROBES_MS = [-36, -24, -12, 0, 12, 24, 36].map((h) => h * HOUR_MS);
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws RangeError for an unknown zone — callers get it unchanged.
    formatter = new Intl.DateTimeFormat("en-US", {
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
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

const parseDayKey = (key: DayKey): [number, number, number] => {
  const match = DAY_KEY_RE.exec(key);
  if (match) {
    const [, y, m, d] = match;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
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

const formatDayKey = (year: number, month: number, day: number): DayKey =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Local wall time of `utcMs` as if it were a UTC instant ("naive" ms). */
const naiveLocalMs = (utcMs: number, timeZone: string): number => {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  // Offsets are whole seconds, so the millisecond digit is the UTC one.
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

/** `DayKey` shifted by whole calendar days. */
export const shiftDayKey = (key: DayKey, days: number): DayKey => {
  const [year, month, day] = parseDayKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return formatDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
};

/** Inclusive list of dates from `from` to `to`. */
export const dayKeysBetween = (from: DayKey, to: DayKey): DayKey[] => {
  const [fy, fm, fd] = parseDayKey(from);
  const [ty, tm, td] = parseDayKey(to);
  const count = (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS + 1;
  if (count < 1) {
    throw new RangeError(`Day range ends before it starts: ${from}..${to}`);
  }
  return Array.from({ length: count }, (_, i) => shiftDayKey(from, i));
};

/** The local date of an instant. */
export const localDayKeyOf = (utcMs: number, timeZone: string): DayKey => {
  const naive = new Date(naiveLocalMs(utcMs, timeZone));
  return formatDayKey(naive.getUTCFullYear(), naive.getUTCMonth() + 1, naive.getUTCDate());
};

/** The local wall time of an instant. */
export const localWallTimeOf = (utcMs: number, timeZone: string): LocalWallTime => {
  const naive = new Date(naiveLocalMs(utcMs, timeZone));
  return {
    hour: naive.getUTCHours(),
    minute: naive.getUTCMinutes(),
    second: naive.getUTCSeconds(),
    millisecond: naive.getUTCMilliseconds(),
  };
};

/**
 * The instant at which `dayKey` shows `wall` in `timeZone`. Gap → the first
 * instant after the gap; fold → the earlier occurrence.
 */
export const resolveLocalWallTime = (
  dayKey: DayKey,
  wall: LocalWallTime,
  timeZone: string,
): number => {
  const [year, month, day] = parseDayKey(dayKey);
  const target = Date.UTC(
    year,
    month - 1,
    day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
    wall.millisecond ?? 0,
  );

  let earliest: number | null = null;
  for (const probe of OFFSET_PROBES_MS) {
    const at = target + probe;
    const candidate = target - (naiveLocalMs(at, timeZone) - at);
    if (naiveLocalMs(candidate, timeZone) === target && (earliest === null || candidate < earliest)) {
      earliest = candidate;
    }
  }
  if (earliest !== null) return earliest;

  // Gap: the wall time never shows. Find the first instant past it.
  let lo = target - SEARCH_RADIUS_MS;
  let hi = target + SEARCH_RADIUS_MS;
  if (naiveLocalMs(lo, timeZone) >= target || naiveLocalMs(hi, timeZone) < target) {
    throw new RangeError(`Cannot resolve ${dayKey} ${JSON.stringify(wall)} in ${timeZone}`);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (naiveLocalMs(mid, timeZone) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
};

/** First instant of a local date. */
export const startOfLocalDay = (dayKey: DayKey, timeZone: string): number =>
  resolveLocalWallTime(dayKey, { hour: 0, minute: 0 }, timeZone);

/** One `[start, end)` interval per local date from `from` to `to` inclusive. */
export const localDayIntervals = (
  range: { from: DayKey; to: DayKey },
  timeZone: string,
): UsageInterval[] => {
  const keys = dayKeysBetween(range.from, range.to);
  if (keys.length > MAX_USAGE_INTERVALS) {
    throw new RangeError(`${keys.length} days requested, at most ${MAX_USAGE_INTERVALS}`);
  }
  const edges = [...keys, shiftDayKey(range.to, 1)].map((key) => startOfLocalDay(key, timeZone));
  return keys.map((key, i) => {
    const start = edges[i] as number;
    const end = edges[i + 1] as number;
    if (end < start) {
      throw new RangeError(`Local date ${key} in ${timeZone} ends before it starts`);
    }
    return { key, start_utc: start, end_utc: end };
  });
};

/** Half-open membership: `start <= ts < end`. */
export const containsHalfOpen = (interval: UsageInterval, utcMs: number): boolean =>
  interval.start_utc <= utcMs && utcMs < interval.end_utc;

/** The same number of local dates immediately before `range` (calendar-based). */
export const previousPeriod = (range: { from: DayKey; to: DayKey }): { from: DayKey; to: DayKey } => {
  const length = dayKeysBetween(range.from, range.to).length;
  return { from: shiftDayKey(range.from, -length), to: shiftDayKey(range.from, -1) };
};

/** Cut every interval at `cutoffMs` (today in progress → `[00:00, now)`). */
export const truncateIntervals = (intervals: UsageInterval[], cutoffMs: number): UsageInterval[] =>
  intervals.map((interval) => ({
    ...interval,
    end_utc: Math.min(interval.end_utc, Math.max(interval.start_utc, cutoffMs)),
  }));

/**
 * Split one interval into two touching intervals at `cutMs` (clamped into the
 * interval), so a same-elapsed comparison never needs overlapping intervals.
 */
export const splitIntervalAt = (
  interval: UsageInterval,
  cutMs: number,
  keys: [string, string] = [`${interval.key}@head`, `${interval.key}@tail`],
): [UsageInterval, UsageInterval] => {
  const cut = Math.min(interval.end_utc, Math.max(interval.start_utc, cutMs));
  return [
    { key: keys[0], start_utc: interval.start_utc, end_utc: cut },
    { key: keys[1], start_utc: cut, end_utc: interval.end_utc },
  ];
};

/**
 * Where to cut the previous period's last day so it ends at the same local
 * wall time as `nowMs` (gap → after the gap, fold → earlier occurrence).
 */
export const sameElapsedCutoff = (
  previousDayKey: DayKey,
  nowMs: number,
  timeZone: string,
): number => resolveLocalWallTime(previousDayKey, localWallTimeOf(nowMs, timeZone), timeZone);
