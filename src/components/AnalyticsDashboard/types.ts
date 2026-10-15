/**
 * AnalyticsDashboard Types
 *
 * Shared type definitions for analytics components.
 */

// ============================================================================
// Props Interfaces
// ============================================================================

export interface AnalyticsDashboardProps {
  /** Show the cross-project overview (the global stats screen). */
  isGlobalScope?: boolean;
  /** Reload the open screen's data; offered by the summary's error state. */
  onRetry?: () => void;
}

// ============================================================================
// Color Variants
// ============================================================================

export type MetricColorVariant = "green" | "purple" | "blue" | "amber";
export type SectionColorVariant = "green" | "purple" | "blue" | "amber" | "pink" | "teal" | "accent";

// ============================================================================
// Component Props
// ============================================================================

/**
 * Day-over-day KPI trend. A percentage is only reported when the previous
 * value is at or above the metric's floor; smaller bases report a direction
 * only, so a near-empty day never produces an absurd figure like +24133%.
 */
export type GrowthTrend =
  | { kind: "pct"; value: number }
  | { kind: "new" }
  | { kind: "none" }
  | { kind: "up-small-base" }
  | { kind: "down-small-base" }
  | { kind: "flat" };

export interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: GrowthTrend;
  colorVariant: MetricColorVariant;
}

export interface SectionCardProps {
  title: string;
  icon?: React.ElementType;
  colorVariant?: SectionColorVariant;
  children: React.ReactNode;
  className?: string;
}

// ============================================================================
// Daily Stats
// ============================================================================

export interface DailyStatData {
  date: string;
  total_tokens: number;
  message_count: number;
  session_count: number;
  active_hours: number;
}

// ============================================================================
// Token Distribution
// ============================================================================

export interface TokenDistribution {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  reasoning: number;
}
