/**
 * Project Analytics Calculations
 *
 * Utility functions for project-level analytics calculations.
 */

import type { ProjectStatsSummary, DailyStats } from "../../../types";
import type { DailyStatData } from "../types";
import { calculateGrowthRate } from "./calculations";

// ============================================================================
// Daily Stats Processing
// ============================================================================

/**
 * Generate full trend data from project stats.
 *
 * When the backend returns daily_stats that span a specific date range (e.g.
 * because a date filter is active), the trend covers the actual data range
 * rather than a hardcoded "today − N days" window.  When dailyStats is empty
 * or absent the original "today − maxDays" behaviour is preserved.
 */
export const generateTrendData = (
  dailyStats: DailyStats[] | undefined,
  maxDays: number = 7
): DailyStatData[] => {
  if (maxDays <= 0) return [];

  const formatUtcDate = (date: Date): string => date.toISOString().slice(0, 10);
  const fallbackYear = new Date().getUTCFullYear();

  const parseDailyDate = (value: string): Date | null => {
    const parts = value.split("-");
    const parsePart = (part: string | undefined, fallback: number): number | null => {
      if (part == null || part.trim() === "") {
        return fallback;
      }
      const parsed = Number(part);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const year = parsePart(parts[0], fallbackYear);
    const month = parsePart(parts[1], 1);
    const day = parsePart(parts[2], 1);

    if (year == null || month == null || day == null) {
      return null;
    }

    if (year <= 1970 || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }

    return parsed;
  };

  const statsByDate = new Map<string, DailyStatData>();
  (dailyStats ?? []).forEach((stat) => {
    const parsedDate = parseDailyDate(stat.date);
    if (parsedDate == null) {
      throw new Error(`Invalid daily_stats date: ${stat.date}`);
    }
    const dateKey = formatUtcDate(parsedDate);
    statsByDate.set(dateKey, {
      date: dateKey,
      total_tokens: stat.total_tokens || 0,
      message_count: stat.message_count || 0,
      session_count: stat.session_count || 0,
      active_hours: stat.active_hours || 0,
    });
  });

  // Determine the date range to display.
  // If the backend returned data, use its actual range so that date-filtered
  // results are displayed correctly. Otherwise fall back to "today − maxDays".
  let endDate: Date;
  let startDate: Date;

  const sortedDates = Array.from(statsByDate.keys()).sort();
  if (sortedDates.length > 0) {
    const firstDateStr = sortedDates[0]!;
    const lastDateStr = sortedDates[sortedDates.length - 1]!;
    const firstDate = parseDailyDate(firstDateStr);
    const lastDate = parseDailyDate(lastDateStr);
    if (firstDate == null || lastDate == null) {
      throw new Error(
        `Invalid daily_stats range: first=${firstDateStr}, last=${lastDateStr}`
      );
    }
    startDate = firstDate;
    endDate = lastDate;
  } else {
    endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    startDate = new Date(endDate);
    startDate.setUTCDate(endDate.getUTCDate() - (maxDays - 1));
  }

  const trendData: DailyStatData[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dateKey = formatUtcDate(cursor);
    const existing = statsByDate.get(dateKey);

    trendData.push(
      existing ?? {
        date: dateKey,
        total_tokens: 0,
        message_count: 0,
        session_count: 0,
        active_hours: 0,
      }
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return trendData;
};

// ============================================================================
// Growth Metrics
// ============================================================================

export interface GrowthMetrics {
  tokenGrowth: number;
  messageGrowth: number;
}

/**
 * Calculate day-over-day growth rates for tokens and messages
 */
export const calculateDailyGrowth = (dailyStats: DailyStats[]): GrowthMetrics => {
  if (dailyStats.length < 2) {
    return { tokenGrowth: 0, messageGrowth: 0 };
  }

  const lastDayStats = dailyStats[dailyStats.length - 1];
  const prevDayStats = dailyStats[dailyStats.length - 2];

  if (!lastDayStats || !prevDayStats) {
    return { tokenGrowth: 0, messageGrowth: 0 };
  }

  return {
    tokenGrowth: calculateGrowthRate(lastDayStats.total_tokens, prevDayStats.total_tokens),
    messageGrowth: calculateGrowthRate(lastDayStats.message_count, prevDayStats.message_count),
  };
};

/**
 * Extract growth metrics from project summary
 */
export const extractProjectGrowth = (projectSummary: ProjectStatsSummary): GrowthMetrics => {
  return calculateDailyGrowth(projectSummary.daily_stats);
};
