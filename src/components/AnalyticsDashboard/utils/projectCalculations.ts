/**
 * Project Analytics Calculations
 *
 * Utility functions for project-level analytics calculations.
 */

import type { ProjectStatsSummary, DailyStat } from "../../../types";
import type { DailyStatData } from "../types";
import { calculateGrowthRate } from "./calculations";

// ============================================================================
// Daily Stats Processing
// ============================================================================

/**
 * Generate 7-day daily data from project stats
 * Maps the last 7 days to daily stats, filling gaps with zeros
 */
export const generateLast7DaysData = (dailyStats: DailyStat[] | undefined): DailyStatData[] => {
  if (!dailyStats) return [];

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return date.toISOString().split("T")[0];
  });

  return last7Days
    .filter((date): date is string => date !== undefined)
    .map((date) => {
      const dayStats = dailyStats.find((stat) => stat.date === date);

      return {
        date,
        total_tokens: dayStats?.total_tokens || 0,
        message_count: dayStats?.message_count || 0,
        session_count: dayStats?.session_count || 0,
        active_hours: dayStats?.active_hours || 0,
      };
    });
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
export const calculateDailyGrowth = (dailyStats: DailyStat[]): GrowthMetrics => {
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
