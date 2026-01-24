/**
 * Analytics API Service
 *
 * Centralized service layer for all analytics-related Tauri API calls.
 * Single source of truth for API contracts and data fetching logic.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  SessionTokenStats,
  PaginatedTokenStats,
  ProjectStatsSummary,
  SessionComparison,
  PaginatedRecentEdits,
  GlobalStatsSummary,
} from "../types";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PAGE_SIZE = 20;

// ============================================================================
// Session Token Stats API
// ============================================================================

/**
 * Fetch token statistics for a single session
 */
export async function fetchSessionTokenStats(
  sessionPath: string
): Promise<SessionTokenStats> {
  const start = performance.now();

  const stats = await invoke<SessionTokenStats>("get_session_token_stats", {
    sessionPath,
  });

  if (import.meta.env.DEV) {
    const duration = performance.now() - start;
    console.log(`[API] fetchSessionTokenStats: ${duration.toFixed(1)}ms`);
  }

  return stats;
}

// ============================================================================
// Project Token Stats API
// ============================================================================

export interface FetchProjectTokenStatsOptions {
  offset?: number;
  limit?: number;
}

/**
 * Fetch paginated token statistics for a project
 */
export async function fetchProjectTokenStats(
  projectPath: string,
  options: FetchProjectTokenStatsOptions = {}
): Promise<PaginatedTokenStats> {
  const { offset = 0, limit = DEFAULT_PAGE_SIZE } = options;
  const start = performance.now();

  const response = await invoke<PaginatedTokenStats>("get_project_token_stats", {
    projectPath,
    offset,
    limit,
  });

  if (import.meta.env.DEV) {
    const duration = performance.now() - start;
    console.log(
      `[API] fetchProjectTokenStats: ${duration.toFixed(1)}ms (${response.total_count} sessions, offset=${offset})`
    );
  }

  return response;
}

// ============================================================================
// Project Stats Summary API
// ============================================================================

/**
 * Fetch comprehensive project statistics summary
 */
export async function fetchProjectStatsSummary(
  projectPath: string
): Promise<ProjectStatsSummary> {
  const start = performance.now();

  const summary = await invoke<ProjectStatsSummary>("get_project_stats_summary", {
    projectPath,
  });

  if (import.meta.env.DEV) {
    const duration = performance.now() - start;
    console.log(
      `[API] fetchProjectStatsSummary: ${duration.toFixed(1)}ms (${summary.total_sessions} sessions)`
    );
  }

  return summary;
}

// ============================================================================
// Session Comparison API
// ============================================================================

/**
 * Fetch session comparison metrics against project averages
 */
export async function fetchSessionComparison(
  sessionId: string,
  projectPath: string
): Promise<SessionComparison> {
  const start = performance.now();

  const comparison = await invoke<SessionComparison>("get_session_comparison", {
    sessionId,
    projectPath,
  });

  if (import.meta.env.DEV) {
    const duration = performance.now() - start;
    console.log(`[API] fetchSessionComparison: ${duration.toFixed(1)}ms`);
  }

  return comparison;
}

// ============================================================================
// Recent Edits API
// ============================================================================

export interface FetchRecentEditsOptions {
  offset?: number;
  limit?: number;
}

/**
 * Fetch paginated recent file edits for a project
 */
export async function fetchRecentEdits(
  projectPath: string,
  options: FetchRecentEditsOptions = {}
): Promise<PaginatedRecentEdits> {
  const { offset = 0, limit = DEFAULT_PAGE_SIZE } = options;
  const start = performance.now();

  const result = await invoke<PaginatedRecentEdits>("get_recent_edits", {
    projectPath,
    offset,
    limit,
  });

  if (import.meta.env.DEV) {
    const duration = performance.now() - start;
    console.log(
      `[API] fetchRecentEdits: ${duration.toFixed(1)}ms (${result.unique_files_count} files, offset=${offset})`
    );
  }

  return result;
}

// ============================================================================
// Global Stats API
// ============================================================================

/**
 * Fetch global statistics across all projects
 */
export async function fetchGlobalStatsSummary(
  claudePath: string
): Promise<GlobalStatsSummary> {
  const start = performance.now();

  const summary = await invoke<GlobalStatsSummary>("get_global_stats_summary", {
    claudePath,
  });

  if (import.meta.env.DEV) {
    const duration = performance.now() - start;
    console.log(
      `[API] fetchGlobalStatsSummary: ${duration.toFixed(1)}ms (${summary.total_projects} projects)`
    );
  }

  return summary;
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export const analyticsApi = {
  fetchSessionTokenStats,
  fetchProjectTokenStats,
  fetchProjectStatsSummary,
  fetchSessionComparison,
  fetchRecentEdits,
  fetchGlobalStatsSummary,
} as const;

export default analyticsApi;
