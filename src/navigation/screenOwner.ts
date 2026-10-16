/**
 * Whose a screen's data is (plan §4.3, the `screen` scope; T8 third review
 * P1).
 *
 * There is one store, and a tab switch commits the incoming place before the
 * incoming screen's loader has run (it runs after the session list). So the
 * store routinely holds a screen value loaded for another place: the outgoing
 * tab's, or one an earlier load left behind when the incoming load failed.
 * Every screen value is therefore written with its owner - the place it was
 * loaded for - and a screen reads it only through the selectors below, which
 * hand it a value only when that owner is the screen's current place.
 * Otherwise the screen gets nothing to show and renders its loading state,
 * or, once its own load has failed (an error owned by its place), its error
 * state.
 *
 * Owners:
 * - project data (the summary, token stats pages, the board, the recent
 *   edits page): the project path it was loaded for;
 * - session data (the session's comparison and token totals): the session
 *   file path;
 * - the docked Recent Edits rows: their request key (project, scope,
 *   grouping, session), which they already carried.
 *
 * App-wide parameters (the date range, the stats mode) are not part of the
 * owner: changing one reloads the screen in place, on the same project, and
 * that refresh keeps showing the previous answer until the new one lands, as
 * it always has. Global stats belong to no project and are not keyed.
 */
import type { FullAppStore } from "@/store/slices/types";
import type { BoardSessionData } from "@/types/board.types";
import type { ProjectStatsSummary, RecentEditsResult, SessionComparison, SessionTokenStats } from "@/types";
import type { RecentEditsPagination } from "@/types/analytics";
import { initialRecentEditsPagination } from "@/types/analytics";
import type { ProjectTokenStatsPagination } from "@/store/slices/messageSlice";
import {
  recentEditsDockRequestKey,
  selectRecentEditsGrouping,
  type RecentEditsDockRequest,
  type RecentEditsDockResult,
} from "@/store/slices/recentEditsPanelSlice";
import { supportsRecentEdits } from "@/utils/providers";

type State = FullAppStore;

/** The place a screen value was loaded for (a project or session file path). */
export type ScreenOwner = string;

/** The owner the current place's project screens expect; `null` without a project. */
export const projectOwner = (s: Pick<State, "selectedProject">): ScreenOwner | null =>
  s.selectedProject?.path ?? null;

/** The owner the current place's session data expects; `null` without a session. */
export const sessionOwner = (s: Pick<State, "selectedSession">): ScreenOwner | null =>
  s.selectedSession?.file_path ?? null;

/** Whether a value written for `owner` is the current place's (`expected`). */
export const isOwnedBy = (owner: ScreenOwner | null | undefined, expected: ScreenOwner | null): boolean =>
  expected !== null && owner === expected;

const EMPTY_STATS: SessionTokenStats[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_BOARD: Record<string, BoardSessionData> = {};

// ---------------------------------------------------------------------------
// Project analytics
// ---------------------------------------------------------------------------

export interface ProjectAnalyticsView {
  projectSummary: ProjectStatsSummary | null;
  projectConversationSummary: ProjectStatsSummary | null;
  /** The place's own summary load is running, or none has answered it yet. */
  isLoading: boolean;
  /** The place's own summary load failed. */
  error: string | null;
  sessionComparison: SessionComparison | null;
  sessionTokenStats: SessionTokenStats | null;
  sessionConversationTokenStats: SessionTokenStats | null;
}

export function selectProjectAnalytics(s: State): ProjectAnalyticsView {
  const project = projectOwner(s);
  const session = sessionOwner(s);
  const a = s.analytics;
  const projectSummary = isOwnedBy(a.projectSummaryOwner, project) ? a.projectSummary : null;
  const error = isOwnedBy(a.projectSummaryErrorOwner, project) ? a.projectSummaryError : null;
  const ownsSessionStats = isOwnedBy(s.sessionTokenStatsOwner, session);
  return {
    projectSummary,
    projectConversationSummary: isOwnedBy(a.projectConversationSummaryOwner, project)
      ? a.projectConversationSummary
      : null,
    isLoading: a.isLoadingProjectSummary || (projectSummary === null && error === null),
    error,
    sessionComparison: isOwnedBy(a.sessionComparisonOwner, session) ? a.sessionComparison : null,
    sessionTokenStats: ownsSessionStats ? s.sessionTokenStats : null,
    sessionConversationTokenStats: ownsSessionStats ? s.sessionConversationTokenStats : null,
  };
}

// ---------------------------------------------------------------------------
// Token stats
// ---------------------------------------------------------------------------

export interface TokenStatsView {
  sessionStats: SessionTokenStats | null;
  sessionConversationStats: SessionTokenStats | null;
  projectStats: SessionTokenStats[];
  projectConversationStats: SessionTokenStats[];
  projectStatsSummary: ProjectStatsSummary | null;
  projectConversationStatsSummary: ProjectStatsSummary | null;
  pagination: ProjectTokenStatsPagination | undefined;
  isLoading: boolean;
  error: string | null;
}

export function selectTokenStats(s: State): TokenStatsView {
  const project = projectOwner(s);
  const ownsProject = isOwnedBy(s.projectTokenStatsOwner, project);
  const ownsSession = isOwnedBy(s.sessionTokenStatsOwner, sessionOwner(s));
  const error = isOwnedBy(s.projectTokenStatsErrorOwner, project) ? s.projectTokenStatsError : null;
  return {
    sessionStats: ownsSession ? s.sessionTokenStats : null,
    sessionConversationStats: ownsSession ? s.sessionConversationTokenStats : null,
    projectStats: ownsProject ? s.projectTokenStats : EMPTY_STATS,
    projectConversationStats: ownsProject ? s.projectConversationTokenStats : EMPTY_STATS,
    projectStatsSummary: ownsProject ? s.projectTokenStatsSummary : null,
    projectConversationStatsSummary: ownsProject ? s.projectConversationTokenStatsSummary : null,
    pagination: ownsProject ? s.projectTokenStatsPagination : undefined,
    isLoading: s.isLoadingTokenStats || (!ownsProject && error === null),
    error,
  };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface BoardView {
  boardSessions: Record<string, BoardSessionData>;
  allSortedSessionIds: string[];
  isLoading: boolean;
  error: string | null;
}

export function selectBoard(s: State): BoardView {
  const project = projectOwner(s);
  const owns = isOwnedBy(s.boardOwner, project);
  const error = isOwnedBy(s.boardLoadErrorOwner, project) ? s.boardLoadError : null;
  return {
    boardSessions: owns ? s.boardSessions : EMPTY_BOARD,
    allSortedSessionIds: owns ? s.allSortedSessionIds : EMPTY_IDS,
    isLoading: s.isLoadingBoard || (!owns && error === null),
    error,
  };
}

// ---------------------------------------------------------------------------
// Recent edits: the page and the dock
// ---------------------------------------------------------------------------

export interface RecentEditsPageView {
  recentEdits: RecentEditsResult | null;
  pagination: RecentEditsPagination;
  isLoading: boolean;
  error: string | null;
}

export function selectRecentEditsPage(s: State): RecentEditsPageView {
  const project = projectOwner(s);
  const a = s.analytics;
  const owns = isOwnedBy(a.recentEditsOwner, project);
  const error = isOwnedBy(a.recentEditsErrorOwner, project) ? a.recentEditsError : null;
  return {
    recentEdits: owns ? a.recentEdits : null,
    pagination: owns ? a.recentEditsPagination : initialRecentEditsPagination,
    isLoading: a.isLoadingRecentEdits || (!owns && error === null),
    error,
  };
}

/**
 * What the dock asks for on the current place, or `null` when it asks
 * nothing (no project, or a provider without recorded edits).
 */
export function selectRecentEditsDockRequest(s: State): RecentEditsDockRequest | null {
  const project = s.selectedProject;
  if (!project || !supportsRecentEdits(project.provider)) return null;
  // With no session selected, session scope has nothing to point at.
  const scope = s.selectedSession ? s.recentEditsScope : "project";
  return {
    projectPath: project.path,
    scope,
    grouping: selectRecentEditsGrouping(s),
    sessionFilePath: s.selectedSession?.file_path,
  };
}

export interface RecentEditsDockView {
  /** The rows answering the current request; `null` until they arrive. */
  result: RecentEditsDockResult | null;
  isLoading: boolean;
  /** The current request's failure. */
  error: string | null;
}

/**
 * The dock's rows, keyed by the request they answer: an answer to an earlier
 * request (another project, scope or session) is never shown. Its error is
 * the current request's when the slot's requested key is the current one -
 * a load writes its error only while it still owns that key.
 */
export function selectRecentEditsDock(s: State, requestKey: string | null): RecentEditsDockView {
  const owns = requestKey !== null && s.recentEditsDock?.requestKey === requestKey;
  const error =
    requestKey !== null && s.recentEditsDockRequestedKey === requestKey ? s.recentEditsDockError : null;
  return {
    result: owns ? s.recentEditsDock : null,
    isLoading: s.isLoadingRecentEditsDock || (requestKey !== null && !owns && error === null),
    error,
  };
}

/** The current dock request's key (`null` when the dock asks nothing). */
export const selectRecentEditsDockKey = (s: State): string | null => {
  const request = selectRecentEditsDockRequest(s);
  return request ? recentEditsDockRequestKey(request) : null;
};
