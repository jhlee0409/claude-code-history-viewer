/**
 * Loading what a screen shows (plan §4.2).
 *
 * The navigation that opens a screen and the reloads that refresh it in place
 * (the header refresh, `refreshAnalytics`, a stats-mode switch, a date-filter
 * change) share these loaders; only the caller decides whether the place
 * moves, so a reload can never advance the navigation epoch.
 *
 * Each load owns its writes the same way (`./ownership`): the latest request
 * of its kind, for the project it was asked for, while no navigation has
 * begun since it started. A load that loses ownership writes nothing - data,
 * screen error or global error - and a superseded failure is not rethrown,
 * because it is no longer the caller's concern. The loading flag is the
 * latest request's to clear: a superseded request never stops a newer one's
 * spinner, and an abandoned one never strands it.
 */
import type { FullAppStore } from "@/store/slices/types";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { ownPlace, type PlaceOwner } from "./ownership";

type Get = () => FullAppStore;

const errorText = (error: unknown, fallback?: string): string =>
  error instanceof Error ? error.message : (fallback ?? String(error));

/** A request counter: `begin()` supersedes every earlier request of the kind. */
function requestCounter() {
  let latest = 0;
  return {
    begin: () => {
      const request = ++latest;
      return () => request === latest;
    },
  };
}

const summaryRequests = requestCounter();
const comparisonRequests = requestCounter();
const recentEditsRequests = requestCounter();

export interface ScreenLoadOptions {
  /** Ownership the caller took (a navigation, before its first await). */
  ownsPlace?: PlaceOwner;
}

function ownerFor(
  get: Get,
  project: ClaudeProject,
  isLatest: () => boolean,
  ownsPlace: PlaceOwner,
): () => boolean {
  return () =>
    isLatest() && ownsPlace() && get().selectedProject?.path === project.path;
}

export interface SessionAnalyticsOptions extends ScreenLoadOptions {
  comparison?: boolean;
  tokenStats?: boolean;
  failureText?: string;
}

/**
 * The open session's comparison and token stats on project analytics. A
 * failure is recorded on the screen (the comparison is dropped with it), not
 * thrown.
 */
export async function loadSessionAnalytics(
  get: Get,
  project: ClaudeProject,
  session: ClaudeSession,
  options: SessionAnalyticsOptions = {},
): Promise<void> {
  const { comparison = true, tokenStats = true } = options;
  const isLatest = comparisonRequests.begin();
  const owns = ownerFor(get, project, isLatest, options.ownsPlace ?? ownPlace(get));

  get().setAnalyticsLoadingSessionComparison(true);
  try {
    const [result] = await Promise.all([
      comparison
        ? get().loadSessionComparison(session.actual_session_id, project.path)
        : Promise.resolve(undefined),
      tokenStats ? get().loadSessionTokenStats(session.file_path) : undefined,
    ]);
    if (!owns()) return;
    if (result !== undefined) get().setAnalyticsSessionComparison(result);
    get().setAnalyticsSessionComparisonError(null);
  } catch (error) {
    if (!owns()) return;
    get().setAnalyticsSessionComparison(null);
    get().setAnalyticsSessionComparisonError(errorText(error, options.failureText));
  } finally {
    if (isLatest()) get().setAnalyticsLoadingSessionComparison(false);
  }
}

export interface ProjectAnalyticsOptions extends ScreenLoadOptions {
  /** Without an open session, also drop an earlier session's comparison. */
  clearComparisonWithoutSession?: boolean;
  failureText?: { summary?: string; comparison?: string };
}

/**
 * Project analytics: the project summary, then the open session's
 * comparison. A summary failure is recorded on the screen and rethrown to the
 * caller while it still owns the screen.
 */
export async function loadProjectAnalytics(
  get: Get,
  project: ClaudeProject,
  session: ClaudeSession | null,
  options: ProjectAnalyticsOptions = {},
): Promise<void> {
  const ownsPlace = options.ownsPlace ?? ownPlace(get);
  const isLatest = summaryRequests.begin();
  const owns = ownerFor(get, project, isLatest, ownsPlace);

  get().setAnalyticsLoadingProjectSummary(true);
  try {
    const summary = await get().loadProjectStatsSummary(project.path, owns);
    if (!owns()) return;
    get().setAnalyticsProjectSummary(summary);
  } catch (error) {
    if (!owns()) return;
    get().setAnalyticsProjectSummaryError(
      errorText(error, options.failureText?.summary),
    );
    throw error;
  } finally {
    if (isLatest()) get().setAnalyticsLoadingProjectSummary(false);
  }

  if (session) {
    await loadSessionAnalytics(get, project, session, {
      ownsPlace,
      failureText: options.failureText?.comparison,
    });
  } else if (options.clearComparisonWithoutSession) {
    get().setAnalyticsSessionComparison(null);
    get().setAnalyticsSessionComparisonError(null);
  }
}

/** Token stats: the project's pages and the open session's totals. */
export async function loadTokenStatsScreen(
  get: Get,
  project: ClaudeProject,
  session: ClaudeSession | null,
): Promise<void> {
  // Both loads carry their own request identity and place ownership.
  await Promise.all([
    get().loadProjectTokenStats(project.path),
    session ? get().loadSessionTokenStats(session.file_path) : undefined,
  ]);
}

export interface RecentEditsLoadOptions extends ScreenLoadOptions {
  failureText?: string;
}

/**
 * The project's recent edits, written as one page with its cursor (#517). A
 * failure is recorded on the screen while owned and always rethrown.
 */
export async function loadRecentEditsScreen(
  get: Get,
  project: ClaudeProject,
  options: RecentEditsLoadOptions = {},
): Promise<void> {
  // The sequence is the half of ownership a project path cannot give: two
  // requests for the *same* project (a refresh while the first load is still
  // running) are told apart by it, so the slower cannot land last.
  const isLatest = recentEditsRequests.begin();
  const owns = ownerFor(get, project, isLatest, options.ownsPlace ?? ownPlace(get));

  try {
    get().setAnalyticsLoadingRecentEdits(true);
    const result = await get().loadRecentEdits(project.path);
    if (!owns()) return;
    get().setAnalyticsRecentEdits(result, project.path);
  } catch (error) {
    if (owns()) {
      get().setAnalyticsRecentEditsError(errorText(error, options.failureText));
    }
    console.error("Failed to load recent edits:", error);
    throw error;
  } finally {
    // Keyed to the latest request, not the selection: a request whose project
    // was deselected must still clear it, since nothing else does.
    if (isLatest()) get().setAnalyticsLoadingRecentEdits(false);
  }
}

/** Reload the board for the open project's loaded sessions. */
export async function reloadBoard(get: Get): Promise<void> {
  get().clearBoard();
  await get().loadBoardSessions(get().sessions);
}
