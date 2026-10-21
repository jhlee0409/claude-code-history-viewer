/**
 * Usage-breakdown local-day adapter (ADR 0002 §2–3, plan §4.8).
 *
 * The calendar and wall-time operations live in `src/lib/format/localDay.ts`
 * — one implementation, one guard (plan D15, ADR 0002 §2). This module
 * re-exports them for the usage-breakdown contract and keeps the usage-only
 * pieces: the `MAX_USAGE_INTERVALS` validation, half-open membership,
 * truncation, splitting, and the same-elapsed cutoff.
 *
 * Expected edges were cross-checked independently with Python `zoneinfo`
 * (scratch/an0a/tz-crosscheck.txt in the AN0a PR).
 */

import { MAX_USAGE_INTERVALS, type UsageInterval } from "@/types/usageBreakdown";
import {
  dayKeysBetween,
  localDayIntervals as formatDayIntervals,
  localDayKey,
  localWallTime,
  previousPeriod,
  resolveLocalWallTime,
  shiftDayKey,
  startOfLocalDay,
  systemTimeZone,
  type DayKey,
} from "@/lib/format/localDay";

export type { DayKey };
export {
  dayKeysBetween,
  previousPeriod,
  resolveLocalWallTime,
  shiftDayKey,
  startOfLocalDay,
  systemTimeZone,
};

/** Local wall time as numeric fields (AN0a shape; seconds/ms optional). */
export interface LocalWallTime {
  hour: number;
  minute: number;
  second?: number;
  millisecond?: number;
}

/** The local wall-clock fields of an instant in `timeZone`. */
export const localWallTimeOf = (utcMs: number, timeZone: string): LocalWallTime =>
  localWallTime(utcMs, timeZone);

/** The local date of an instant (AN0a API: numbers only, never `null`). */
export const localDayKeyOf = (utcMs: number, timeZone: string): DayKey => {
  const key = localDayKey(utcMs, timeZone);
  if (key === null) throw new RangeError(`Unreadable timestamp: ${utcMs}`);
  return key;
};

/**
 * One `[start, end)` interval per local date from `from` to `to` inclusive,
 * refusing more intervals than the backend accepts.
 */
export const localDayIntervals = (
  range: { from: DayKey; to: DayKey },
  timeZone: string,
): UsageInterval[] => {
  const keys = dayKeysBetween(range.from, range.to);
  if (keys.length > MAX_USAGE_INTERVALS) {
    throw new RangeError(`${keys.length} days requested, at most ${MAX_USAGE_INTERVALS}`);
  }
  return formatDayIntervals(range, timeZone);
};

/** Half-open membership: `start <= ts < end`. */
export const containsHalfOpen = (interval: UsageInterval, utcMs: number): boolean =>
  interval.start_utc <= utcMs && utcMs < interval.end_utc;

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
