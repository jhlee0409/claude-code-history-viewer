/**
 * AnalyticsDashboard Types
 *
 * Shared type definitions for analytics components.
 */

// ============================================================================
// Props Interfaces
// ============================================================================

export interface AnalyticsDashboardProps {
  isViewingGlobalStats?: boolean;
}

// ============================================================================
// Color Variants
// ============================================================================

export type MetricColorVariant = "green" | "purple" | "blue" | "amber";
export type SectionColorVariant = "green" | "purple" | "blue" | "amber" | "accent";

// ============================================================================
// Component Props
// ============================================================================

export interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: number;
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
}
