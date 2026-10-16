/**
 * Place: the one answer to "where is the user?" (plan §4.1).
 *
 * A place is the screen (`view`) plus the context it keeps: the project and
 * session the sidebar holds on to. Switching to analytics, global stats or the
 * archive does not drop that context, so coming back to the conversation lands
 * where the user left.
 *
 * Everything here is pure. The store holds the view (`navigationSlice`) and
 * the selection (`selectedProject` / `selectedSession`); `selectPlace` joins
 * them. Every highlight on screen (header view tabs, the sidebar's library row,
 * the tree selection, the mobile tab bar) is a projection of the place, so a
 * highlight can no longer disagree with what the main area shows.
 */
import type { ClaudeProject, ClaudeSession } from "@/types";

export type View =
  | "empty"
  | "conversation"
  | "analytics"
  | "edits"
  | "board"
  | "globalStats"
  | "archive"
  | "settingsManager"
  /**
   * Transitional (plan C1): stays until token stats becomes an analytics
   * sub-tab (T9b).
   */
  | "tokenStats";

/** A project is identified by its provider and storage path. */
export interface ProjectRef {
  provider: string;
  path: string;
}

/**
 * A session loads by `filePath` + `provider`; `sessionId` is the display and
 * metadata key.
 */
export interface SessionRef {
  provider: string;
  filePath: string;
  sessionId: string;
  actualSessionId?: string;
  /**
   * The `path` of the project that lists the session, recorded by the
   * sidebar library (recent, favourites) so an entry opens its project
   * directly. Most providers list projects under a virtual path
   * (`codex://{cwd}`) while the session file lives elsewhere, so the file path
   * alone does not name the project. Absent in a place and in refs saved
   * before it existed.
   */
  projectPath?: string;
}

export interface Place {
  view: View;
  project?: ProjectRef;
  session?: SessionRef;
}

const DEFAULT_PROVIDER = "claude";

export function projectRefOf(project: ClaudeProject | null | undefined): ProjectRef | undefined {
  if (!project) return undefined;
  return { provider: project.provider ?? DEFAULT_PROVIDER, path: project.path };
}

export function sessionRefOf(session: ClaudeSession | null | undefined): SessionRef | undefined {
  if (!session) return undefined;
  return {
    provider: session.provider ?? DEFAULT_PROVIDER,
    filePath: session.file_path,
    sessionId: session.session_id,
    ...(session.actual_session_id ? { actualSessionId: session.actual_session_id } : {}),
  };
}

export function placeOf(
  view: View,
  project: ClaudeProject | null | undefined,
  session: ClaudeSession | null | undefined
): Place {
  const projectRef = projectRefOf(project);
  const sessionRef = sessionRefOf(session);
  return {
    view,
    ...(projectRef ? { project: projectRef } : {}),
    ...(sessionRef ? { session: sessionRef } : {}),
  };
}

// ---------------------------------------------------------------------------
// Scopes and validity
// ---------------------------------------------------------------------------

/** Screens about one project; they need a project in context. */
const PROJECT_VIEWS: ReadonlySet<View> = new Set([
  "analytics",
  "edits",
  "board",
  "tokenStats",
]);

/** Screens about the whole app; they need no context and keep whatever is held. */
const APP_VIEWS: ReadonlySet<View> = new Set(["globalStats", "archive", "settingsManager"]);

export const isProjectView = (view: View): boolean => PROJECT_VIEWS.has(view);
export const isAppView = (view: View): boolean => APP_VIEWS.has(view);

export type PlaceFallback = "noProject" | "noSession";

export interface ResolvedPlace {
  /** The screen that can actually render. */
  view: View;
  /** Why it differs from the requested view, or null when it does not. */
  fallback: PlaceFallback | null;
}

/**
 * The validity table (plan §4.1): a screen whose context is missing renders
 * as the empty screen instead.
 *
 * | view                               | needs             | otherwise |
 * |------------------------------------|-------------------|-----------|
 * | conversation                       | project + session | empty     |
 * | analytics, edits, board, tokenStats| project           | empty     |
 * | globalStats, archive, settings, empty | –              | –         |
 *
 * Applied at runtime by `navigate` (a project screen without a project lands
 * on `empty`, with the reason) and by the screen flags
 * (`useAnalyticsComputed`). A conversation without a session keeps its view
 * and renders its "select a session" state: the transitional form of `empty`
 * until documents arrive (T8).
 */
export function resolvePlace(place: Place): ResolvedPlace {
  if (place.view === "conversation") {
    if (!place.project) return { view: "empty", fallback: "noProject" };
    if (!place.session) return { view: "empty", fallback: "noSession" };
    return { view: "conversation", fallback: null };
  }
  if (isProjectView(place.view) && !place.project) {
    return { view: "empty", fallback: "noProject" };
  }
  return { view: place.view, fallback: null };
}

/**
 * The screen to show once the project context is dropped (sidebar re-click,
 * provider filter, a project that vanished on refresh). Global stats does not
 * depend on a project, so it stays; anything else returns to the
 * conversation screen, which renders empty without a session.
 */
export function viewAfterLeavingProject(view: View): View {
  return view === "globalStats" ? "globalStats" : "conversation";
}

/**
 * The screen a sidebar project click lands on. Project screens follow the
 * user to the new project; global stats becomes that project's analytics; the
 * Settings Manager keeps going with the new project as its context; anything
 * else opens the conversation screen.
 */
export function viewForProjectSwitch(view: View): View {
  switch (view) {
    case "analytics":
    case "globalStats":
      return "analytics";
    case "tokenStats":
    case "edits":
    case "board":
    case "settingsManager":
      return view;
    default:
      return "conversation";
  }
}

export function samePlace(a: Place, b: Place): boolean {
  return (
    a.view === b.view &&
    a.project?.path === b.project?.path &&
    a.project?.provider === b.project?.provider &&
    a.session?.filePath === b.session?.filePath
  );
}

// ---------------------------------------------------------------------------
// Highlight projections (plan §9b C3)
// ---------------------------------------------------------------------------

/**
 * The toolbar's screen tabs (plan T7). Token stats has no tab of its own
 * (plan C1): it opens from inside analytics until it becomes an analytics
 * sub-tab (T9b), so while it shows, the analytics tab is the selected one.
 */
export type ToolbarView = "conversation" | "analytics" | "edits" | "board";

const TOOLBAR_VIEWS: ReadonlySet<View> = new Set<ToolbarView>([
  "conversation",
  "analytics",
  "edits",
  "board",
]);

/**
 * The toolbar tab to show as selected: the current view when it is a project
 * screen with a project in context, otherwise none. Global stats, the archive
 * and the Settings Manager have no tab, so none is selected while they are
 * open.
 */
export function activeToolbarView(place: Place): ToolbarView | null {
  if (!place.project) return null;
  if (place.view === "tokenStats") return "analytics";
  return TOOLBAR_VIEWS.has(place.view) ? (place.view as ToolbarView) : null;
}

/** The sidebar library rows of the app-level screens (plan T7). */
export type LibraryItem = "globalStats" | "archive" | "settingsManager";

export function activeLibraryItem(place: Place): LibraryItem | null {
  return isAppView(place.view) ? (place.view as LibraryItem) : null;
}

export interface TreeSelection {
  projectPath: string | null;
  sessionFilePath: string | null;
  /**
   * True while an app-level screen is open: the tree still shows the kept
   * context, but it is not what the main area shows.
   */
  retained: boolean;
}

export function treeSelection(place: Place): TreeSelection {
  return {
    projectPath: place.project?.path ?? null,
    sessionFilePath: place.session?.filePath ?? null,
    retained: activeLibraryItem(place) !== null,
  };
}

/** Bottom tab bar ids on the mobile layout. */
export type MobileTab = "messages" | "board" | "analytics" | "settings";

/**
 * The mobile tab bar has no library, so app screens other than the Settings
 * Manager select no tab. The messages tab stays selected on an empty start, as
 * it always has on this layout (the tab bar is replaced in T7).
 */
export function activeMobileTab(place: Place): MobileTab | null {
  switch (place.view) {
    case "conversation":
    case "empty":
      return "messages";
    case "board":
      return "board";
    case "analytics":
      return "analytics";
    case "settingsManager":
      return "settings";
    default:
      return null;
  }
}
