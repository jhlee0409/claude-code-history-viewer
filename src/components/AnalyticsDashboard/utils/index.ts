/**
 * AnalyticsDashboard Utils
 *
 * Re-exports all utility functions.
 */

// Base calculations
export {
  calculateGrowthTrend,
  formatNumber,
  formatCurrency,
  calculateModelPrice,
  hasExplicitModelPricing,
  MODEL_PRICING_AUDITED_AT,
  getHeatColor,
  getHeatTextColor,
} from "./calculations";

// Tool name utilities
export { getToolDisplayName } from "./toolNames";

// Session-level calculations
export {
  calculateSessionMetrics,
  calculateSessionComparisonMetrics,
  type SessionMetrics,
  type SessionComparisonMetrics,
} from "./sessionCalculations";

// Project-level calculations
export {
  generateTrendData,
  calculateDailyGrowth,
  GROWTH_FLOORS,
  extractProjectGrowth,
  type GrowthMetrics,
} from "./projectCalculations";

// Global-level calculations
export {
  calculateModelMetrics,
  calculateGlobalCostSummary,
  calculateRetirementImpact,
  getRankMedal,
  hasMedal,
  type ModelDisplayMetrics,
  type GlobalCostSummary,
  type RankMedal,
} from "./globalCalculations";
