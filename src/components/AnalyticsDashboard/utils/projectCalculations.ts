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

  const statsByDate = new Map<string, DailyStatData>();
  (dailyStats ?? []).forEach((stat) => {
    statsByDate.set(stat.date, {
      date: stat.date,
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
    // Parse YYYY-MM-DD as UTC
    const [fy, fm, fd] = firstDateStr.split("-").map(Number);
    const [ly, lm, ld] = lastDateStr.split("-").map(Number);
    startDate = new Date(Date.UTC(fy!, fm! - 1, fd!));
    endDate = new Date(Date.UTC(ly!, lm! - 1, ld!));
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
