/**
 * AnalyticsDashboard Utils
 *
 * Re-exports all utility functions.
 */

// Base calculations
export {
  calculateGrowthRate,
  formatNumber,
  calculateModelPrice,
  hasExplicitModelPricing,
  getHeatColor,
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
  extractProjectGrowth,
  type GrowthMetrics,
} from "./projectCalculations";

// Global-level calculations
export {
  calculateModelMetrics,
  calculateGlobalCostSummary,
  getRankMedal,
  hasMedal,
  type ModelDisplayMetrics,
  type GlobalCostSummary,
  type RankMedal,
} from "./globalCalculations";
