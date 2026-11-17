/**
 * Project Analytics Calculations
 *
 * Utility functions for project-level analytics calculations.
 */

import type { ProjectStatsSummary, DailyStats } from "../../../types";
import type { DailyStatData, GrowthTrend } from "../types";
import { calculateGrowthTrend } from "./calculations";
import { dayKeysBetween, isDayKey, localDayKey, shiftDayKey } from "@/lib/format/localDay";

// ============================================================================
// Daily Stats Processing
// ============================================================================

/**
 * Generate full trend data from project stats.
 *
 * When the backend returns daily_stats that span a specific date range (e.g.
 * because a date filter is active), the trend covers the actual data range
 * rather than a hardcoded "today − N days" window.  When dailyStats is empty
 * or absent the window is the last `maxDays` **local** calendar days ending
 * today (`timeZone`, default: the system zone) — not the UTC date, which is
 * still yesterday for the first hours of a day east of Greenwich.
 *
 * Rows are keyed by the backend's `YYYY-MM-DD` and handled as calendar dates
 * (no `Date` round trip, so no time-zone shift).
 */
export const generateTrendData = (
  dailyStats: DailyStats[] | undefined,
  maxDays: number = 7,
  timeZone?: string
): DailyStatData[] => {
  if (maxDays <= 0) return [];

  const statsByDate = new Map<string, DailyStatData>();
  (dailyStats ?? []).forEach((stat) => {
    const dateKey = normalizeDailyDate(stat.date);
    if (dateKey == null) {
      throw new Error(`Invalid daily_stats date: ${stat.date}`);
    }
    statsByDate.set(dateKey, {
      date: dateKey,
      total_tokens: stat.total_tokens || 0,
      message_count: stat.message_count || 0,
      session_count: stat.session_count || 0,
      active_hours: stat.active_hours || 0,
    });
  });

  // If the backend returned data, use its actual range so that date-filtered
  // results are displayed correctly. Otherwise fall back to "today − maxDays".
  const sortedDates = Array.from(statsByDate.keys()).sort();
  const today = localDayKey(Date.now(), timeZone) as string;
  const range =
    sortedDates.length > 0
      ? dayKeysBetween(sortedDates[0]!, sortedDates[sortedDates.length - 1]!)
      : dayKeysBetween(shiftDayKey(today, -(maxDays - 1)), today);

  return range.map(
    (dateKey) =>
      statsByDate.get(dateKey) ?? {
        date: dateKey,
        total_tokens: 0,
        message_count: 0,
        session_count: 0,
        active_hours: 0,
      }
  );
};

/**
 * A backend date (`YYYY-MM-DD`, month/day optional and defaulting to 1, year
 * defaulting to the current one) as a canonical day key; `null` if invalid.
 */
const normalizeDailyDate = (value: string): string | null => {
  const parts = value.split("-");
  const parsePart = (part: string | undefined, fallback: number): number | null => {
    if (part == null || part.trim() === "") return fallback;
    const parsed = Number(part);
    return Number.isInteger(parsed) ? parsed : null;
  };
  const year = parsePart(parts[0], new Date().getFullYear());
  const month = parsePart(parts[1], 1);
  const day = parsePart(parts[2], 1);
  if (year == null || month == null || day == null || year <= 1970) return null;
  const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isDayKey(key) ? key : null;
};

// ============================================================================
// Growth Metrics
// ============================================================================

/**
 * Smallest previous-day value a percentage is shown against, per metric.
 * Below it the KPI card shows only the direction of the change.
 */
export const GROWTH_FLOORS = {
  messages: 20,
  tokens: 10_000,
} as const;

export interface GrowthMetrics {
  tokenGrowth: GrowthTrend;
  messageGrowth: GrowthTrend;
}

const NO_GROWTH: GrowthMetrics = {
  tokenGrowth: { kind: "none" },
  messageGrowth: { kind: "none" },
};

/**
 * Calculate day-over-day growth trends for tokens and messages.
 *
 * `dailyStats` is sorted by date and sparse (days without activity have no
 * row), so the baseline is the calendar day before the last recorded day,
 * which counts as zero when it has no row — not simply the row before it.
 */
export const calculateDailyGrowth = (dailyStats: DailyStats[]): GrowthMetrics => {
  const lastDayStats = dailyStats.at(-1);

  if (!lastDayStats || dailyStats.length < 2) {
    return NO_GROWTH;
  }

  const baselineDate = shiftDayKey(lastDayStats.date, -1);
  const prevDayStats = dailyStats.find((stats) => stats.date === baselineDate);
  const prevTokens = prevDayStats?.total_tokens ?? 0;
  const prevMessages = prevDayStats?.message_count ?? 0;

  return {
    tokenGrowth: calculateGrowthTrend(
      lastDayStats.total_tokens,
      prevTokens,
      GROWTH_FLOORS.tokens,
    ),
    messageGrowth: calculateGrowthTrend(
      lastDayStats.message_count,
      prevMessages,
      GROWTH_FLOORS.messages,
    ),
  };
};

/**
 * Extract growth metrics from project summary
 */
export const extractProjectGrowth = (projectSummary: ProjectStatsSummary): GrowthMetrics => {
  return calculateDailyGrowth(projectSummary.daily_stats);
};
