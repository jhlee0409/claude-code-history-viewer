/**
 * Session Analytics Calculations
 *
 * Utility functions for session-level analytics calculations.
 */

import type { SessionTokenStats, SessionComparison } from "../../../types";
import type { TokenDistribution } from "../types";

// ============================================================================
// Session Metrics
// ============================================================================

export interface SessionMetrics {
  avgTokensPerMessage: number;
  durationMs: number;
  durationMinutes: number;
  distribution: TokenDistribution;
}

/**
 * Calculate all session metrics from token stats
 */
export const calculateSessionMetrics = (stats: SessionTokenStats): SessionMetrics => {
  const avgTokensPerMessage =
    stats.message_count > 0
      ? Math.round(stats.total_tokens / stats.message_count)
      : 0;

  const durationMs =
    new Date(stats.last_message_time).getTime() -
    new Date(stats.first_message_time).getTime();

  const durationMinutes = Math.round(durationMs / (1000 * 60));

  const distribution: TokenDistribution = {
    input: stats.total_input_tokens,
    output: stats.total_output_tokens,
    cache_creation: stats.total_cache_creation_tokens,
    cache_read: stats.total_cache_read_tokens,
  };

  return {
    avgTokensPerMessage,
    durationMs,
    durationMinutes,
    distribution,
  };
};

// ============================================================================
// Session Comparison Metrics
// ============================================================================

export interface SessionComparisonMetrics {
  isAboveAverage: boolean;
  statusColor: string;
  percentile: number;
}

/**
 * Calculate session comparison display metrics
 */
export const calculateSessionComparisonMetrics = (
  comparison: SessionComparison,
  totalProjectSessions: number
): SessionComparisonMetrics => {
  const isAboveAverage = comparison.is_above_average;
  const statusColor = isAboveAverage ? "var(--metric-green)" : "var(--metric-amber)";

  const percentile =
    totalProjectSessions > 0
      ? Math.round(100 - (comparison.rank_by_tokens / totalProjectSessions) * 100)
      : 0;

  return {
    isAboveAverage,
    statusColor,
    percentile,
  };
};
