/**
 * Navigation: where the user is and how they get somewhere else.
 *
 * The current place is `view` here plus the selection the project and message
 * slices hold (`selectedProject`, `selectedSession`); `selectPlace` joins them.
 * There is no second copy of the screen anywhere: the header, the sidebar and
 * the mobile tab bar all project their highlight from this place
 * (`src/navigation/place.ts`).
 *
 * Moving the user is one transaction, `navigate` (plan §4.2):
 *
 * 1. The target is captured and the navigation epoch advances before anything
 *    awaits; the screen (validated against the place's context, §4.1) and
 *    the URL of the selection it drops are committed at once.
 * 2. Every write that lands after an await checks that it still owns what it
 *    writes (`src/navigation/ownership.ts`): data by request identity,
 *    anything else the user sees (the global error, the URL, the target, the
 *    place) also by the epoch. A slow load can no longer land on top of a
 *    later choice, nor raise its failure over the screen the user moved to.
 * 3. Only then are a new message target and the back/forward history
 *    written. (The outgoing session's target leaves with it in step 1.)
 *
 * Reloading what is on screen is not navigation: the watcher, filter toggles,
 * the header refresh, `refreshAnalytics` and the restore after a screen switch
 * reload through `reloadCurrent` and the shared screen loaders
 * (`src/navigation/screenData.ts`); they never change the place and never
 * advance the epoch, and a navigation that starts meanwhile supersedes them.
 */
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import type { ClaudeMessage, ClaudeProject, ClaudeSession } from "../../types";
import {
  beginHistoryStep,
  type WebUIHistoryMode,
  type WebUINavigationOptions,
  writeWebUIDeepLink,
} from "@/utils/webuiDeepLink";
import { toast } from "sonner";
import i18n from "@/i18n";
import {
  isProjectView,
  DEFAULT_ANALYTICS_TAB,
  placeOf,
  samePlace,
  viewAfterLeavingProject,
  type AnalyticsTab,
  type Place,
  type PlaceFallback,
  type View,
} from "@/navigation/place";
import { INITIAL_PAGINATION } from "./messageSlice";
import type { PendingAnchor } from "./documentSlice";
import {
  loadRecent,
  pushRecent,
  recentEntryOf,
  saveRecent,
  type RecentEntry,
} from "@/navigation/library";

/** Where a navigation goes. Omitted fields keep the current context. */
export interface NavigateTarget {
  /**
   * The screen. Omitted: keep the current one (dropping the project still
   * moves a project screen back to the conversation screen).
   */
  view?: View;
  /**
   * The analytics sub-tab to show (T9b). Omitted: keep the current one - the
   * toolbar's analytics tab reopens the sub-tab last shown in this tab.
   */
  analyticsTab?: AnalyticsTab;
  /** `undefined` keeps, `null` drops, a project opens it (no-op if open). */
  project?: ClaudeProject | null;
  /** Opens this session, or `null` closes the open one and keeps the project. */
  session?: ClaudeSession | null;
  /**
   * The whole message list of `session`, when the caller already holds it
   * (the board's lane cache): the session opens from it instead of fetching.
   */
  sessionMessages?: ClaudeMessage[];
  /** An explicit message target inside the session (search, deep link, CLI). */
  messageId?: string | null;
  /**
   * `session` is a subagent transcript opened from these parents, root first
   * (a tab restoring its subagent path, plan §4.3). Given, it replaces the
   * subagent path; `[]` opens `session` at top level.
   */
  subagentStack?: ClaudeSession[];
}

export interface NavigateOptions {
  /** WebUI URL history mode for this move (default "push"). */
  history?: WebUIHistoryMode;
  /** Record the move in back/forward history (default true). */
  record?: boolean;
  /**
   * An epoch claimed earlier with `beginNavigation`, for a navigation whose
   * target is resolved asynchronously (CLI hint, deep link). If anything else
   * navigated since, the call is a no-op and resolves `false`.
   */
  epoch?: number;
  /**
   * The scroll position to restore once the session shows (a tab being
   * reopened, plan §4.3). Every other navigation drops a pending one.
   */
  anchor?: PendingAnchor;
}

/** One back/forward history entry: the place plus its explicit target. */
export interface PlaceHistoryEntry {
  view: View;
  /** The analytics sub-tab shown at the time (meaningful on `analytics` only). */
  analyticsTab: AnalyticsTab;
  project: ClaudeProject | null;
  session: ClaudeSession | null;
  messageId: string | null;
}

export const PLACE_HISTORY_LIMIT = 50;

export interface NavigationSliceState {
  /** The screen of the current place. */
  view: View;
  /**
   * The analytics sub-tab of the current place (T9b). Kept while another
   * screen shows, so coming back to analytics lands on the same sub-tab.
   */
  analyticsTab: AnalyticsTab;
  /**
   * Advances on every navigation. Async work started by a navigation compares
   * against it and gives up once a newer one has begun.
   */
  navigationEpoch: number;
  placeHistory: { back: PlaceHistoryEntry[]; forward: PlaceHistoryEntry[] };
  targetMessageUuid: string | null;
  shouldHighlightTarget: boolean;
  /**
   * Which setting of the target is current: advances whenever the target is
   * set or cleared. Work on behalf of a target (its lookup) owns it only
   * while this is unchanged; uuid and tab id alone repeat after A→B→A.
   */
  targetRequest: number;
  /**
   * Sessions the user opened, newest first (the sidebar library's "Recent",
   * plan T7). Persisted (`library.recent.v1`), at most 12.
   */
  recentSessions: RecentEntry[];
}

export interface NavigationSliceActions {
  navigate: (target: NavigateTarget, options?: NavigateOptions) => Promise<boolean>;
  /**
   * Claim the next epoch for a navigation whose target is still being
   * resolved. Anything that navigates meanwhile supersedes it.
   */
  beginNavigation: () => number;
  /**
   * Move the back/forward cursor one step and return the entry to open, or
   * null at either end. The caller opens it with `navigate(..., {record:false})`
   * and loads the screen's data (`usePlaceHistory`).
   */
  stepPlaceHistory: (direction: "back" | "forward") => PlaceHistoryEntry | null;
  navigateToMessage: (uuid: string, options?: WebUINavigationOptions) => void;
  clearTargetMessage: () => void;
  /**
   * Page the explicit target into the loaded window (it may live in an older
   * page) and resolve whether it is there. When it is not, the target is
   * cleared - only while it is still the target this lookup was started for
   * (`targetRequest`): a late answer must not clear a target set since, even
   * the same uuid restored in the same tab after A→B→A (plan §4.3, §9b).
   */
  lookUpTargetMessage: () => Promise<boolean>;
}

export type NavigationSlice = NavigationSliceState & NavigationSliceActions;

/** The current place: the screen plus the context the sidebar holds. */
export function selectPlace(state: FullAppStore): Place {
  return placeOf(state.view, state.selectedProject, state.selectedSession, state.analyticsTab);
}

const entryOf = (state: FullAppStore): PlaceHistoryEntry => ({
  view: state.view,
  analyticsTab: state.analyticsTab,
  project: state.selectedProject,
  session: state.selectedSession,
  messageId: state.targetMessageUuid,
});

const FALLBACK_REASON_KEY: Record<PlaceFallback, string> = {
  noProject: "common.hooks.noProjectSelected",
  noSession: "session.select",
};

/** Tell the user why the move landed somewhere other than asked (§4.1). */
export function notifyFallback(fallback: PlaceFallback): void {
  toast.info(i18n.t(FALLBACK_REASON_KEY[fallback]));
}

const placeOfEntry = (entry: PlaceHistoryEntry): Place =>
  placeOf(entry.view, entry.project, entry.session, entry.analyticsTab);

export const initialNavigationState: NavigationSliceState = {
  view: "conversation",
  analyticsTab: DEFAULT_ANALYTICS_TAB,
  navigationEpoch: 0,
  placeHistory: { back: [], forward: [] },
  targetMessageUuid: null,
  shouldHighlightTarget: false,
  targetRequest: 0,
  recentSessions: [],
};

export const createNavigationSlice: StateCreator<
  FullAppStore,
  [],
  [],
  NavigationSlice
> = (set, get) => ({
  ...initialNavigationState,
  recentSessions: loadRecent(),

  beginNavigation: () => {
    const epoch = get().navigationEpoch + 1;
    set({ navigationEpoch: epoch });
    return epoch;
  },

  navigate: async (target, options = {}) => {
    const start = get();
    if (options.epoch !== undefined && options.epoch !== start.navigationEpoch) {
      return false;
    }
    const epoch = options.epoch ?? start.navigationEpoch + 1;
    // This navigation's own place ownership (`src/navigation/ownership.ts`):
    // every write after an await below needs it.
    const ownsPlace = () => get().navigationEpoch === epoch;
    const history = options.history ?? "push";
    const from = entryOf(start);

    // Board hover is a property of the board screen, not of a place. A
    // pending scroll anchor belongs to the tab opening that set it.
    set({
      navigationEpoch: epoch,
      boardHoverSession: null,
      pendingAnchor: options.anchor ?? null,
    });
    // A tab that could not be opened is the user's own again once they
    // move inside it: cleared as the move begins, so nothing retries the
    // tab meanwhile, and a session that fails to load in this move marks
    // it again (`markSessionUnavailable`).
    const activeId = start.activeDocumentId;
    if (start.documents.some((d) => d.id === activeId && d.unavailable)) {
      set(({ documents }) => ({
        documents: documents.map((d) => (d.id === activeId ? { ...d, unavailable: null } : d)),
      }));
    }

    const openProject = start.selectedProject;
    const dropsProject = target.project === null && openProject !== null;
    const opensProject =
      target.project != null && target.project.path !== openProject?.path;

    // `empty` is where a fallback lands, never a screen to stay on: a move
    // that names no screen goes to the conversation from there.
    const kept = start.view === "empty" ? "conversation" : start.view;
    let view = target.view ?? kept;
    // Every URL write below belongs to this one history step.
    const historyMode = beginHistoryStep(history);
    if (dropsProject) {
      get().clearProjectSelection({ history: historyMode() });
      view = target.view ?? viewAfterLeavingProject(kept);
    }
    // Validity (plan §4.1): a project screen needs a project, otherwise the
    // move lands on the empty screen and says why. The conversation without
    // a session keeps its own view and renders its "select a session" state
    // (the transitional representation of `empty` until T8).
    const projectAfter = dropsProject ? null : (target.project ?? openProject);
    if (isProjectView(view) && !projectAfter) {
      view = "empty";
      notifyFallback("noProject");
    }
    // The screen is the user's intent; commit it before anything loads.
    set({ view, ...(target.analyticsTab ? { analyticsTab: target.analyticsTab } : {}) });

    // The explicit target belongs to its session, so it leaves with it:
    // dropped together with the selection change, before the first await, so
    // a move cancelled mid-load cannot carry it to the next session. Only a
    // new explicit target waits for the load (below).
    const leavesSession =
      start.selectedSession != null &&
      (opensProject ||
        target.session === null ||
        (target.session != null &&
          target.session.file_path !== start.selectedSession.file_path));
    if (leavesSession) get().clearTargetMessage();

    // The URL changes together with the selection it mirrors. Opening a
    // project drops the open session at once (`selectProject`), so the URL
    // drops it here too, before the first await: a navigation cancelled
    // during the project load must not leave the outgoing session in it.
    if (opensProject) {
      writeWebUIDeepLink({ sessionId: null, messageId: null }, historyMode());
      await get().selectProject(target.project as ClaudeProject);
    }
    // Every step below lands after the project load: only while this
    // navigation still owns the place.
    if (!ownsPlace()) return false;
    // The project's sessions could not be read (its folder deleted since the
    // last scan): its tab says so in place (`markProjectUnavailable`), and
    // nothing of the place opens - not its session, not its target.
    if (opensProject && get().selectedProject === null) {
      set({ hydratedDocumentId: get().activeDocumentId, tabsRestorePending: false });
      return true;
    }

    if (target.session) {
      await get().selectSession(target.session, {
        history: historyMode(),
        cachedMessages: target.sessionMessages,
        parentStack: target.subagentStack,
      });
    } else if (target.session === null && get().selectedSession) {
      set({
        selectedSession: null,
        messages: [],
        pagination: { ...INITIAL_PAGINATION },
        isLoadingMessages: false,
        subagentSessions: [],
        parentSessionStack: [],
      });
      get().clearTargetMessage();
      writeWebUIDeepLink({ sessionId: null, messageId: null }, historyMode());
    }
    // ...and after the session load.
    if (!ownsPlace()) return false;

    // The explicit target belongs to its session. `messageId` omitted keeps
    // it (a screen switch), `null` drops it, and opening another session
    // drops it unless the move names a new one.
    const changedSession =
      from.session?.file_path !== get().selectedSession?.file_path;
    if (typeof target.messageId === "string") {
      get().navigateToMessage(target.messageId, { history: historyMode() });
    } else if (target.messageId === null || changedSession) {
      get().clearTargetMessage();
      const session = get().selectedSession;
      if (session) {
        writeWebUIDeepLink(
          {
            sessionId: session.actual_session_id || session.session_id,
            messageId: null,
          },
          historyMode(),
        );
      }
    }

    // A session the user arrived at joins the library's recent list. A
    // subagent's transcript is a synthetic session inside its parent, not a
    // place of its own.
    const opened = get().selectedSession;
    if (changedSession && opened && get().parentSessionStack.length === 0) {
      const recentSessions = pushRecent(get().recentSessions, recentEntryOf(opened, Date.now(), get().selectedProject));
      set({ recentSessions });
      saveRecent(recentSessions);
    }

    if (options.record !== false) {
      const to = entryOf(get());
      if (!samePlace(placeOfEntry(from), placeOfEntry(to))) {
        set(({ placeHistory }) => ({
          placeHistory: {
            back: [...placeHistory.back, from].slice(-PLACE_HISTORY_LIMIT),
            forward: [],
          },
        }));
      }
    }
    // The live state is now the active tab's (plan §4.3): a snapshot taken
    // from here on records it.
    set({
      hydratedDocumentId: get().activeDocumentId,
      // The user (or a hint) moved before the restored tab opened: what
      // they chose stays, the restore is off.
      tabsRestorePending: false,
    });
    return true;
  },

  stepPlaceHistory: (direction) => {
    const { placeHistory } = get();
    const source = direction === "back" ? placeHistory.back : placeHistory.forward;
    const entry = source[source.length - 1];
    if (!entry) return null;
    const current = entryOf(get());
    const remaining = source.slice(0, -1);
    set({
      placeHistory:
        direction === "back"
          ? { back: remaining, forward: [...placeHistory.forward, current] }
          : { back: [...placeHistory.back, current], forward: remaining },
    });
    return entry;
  },

  navigateToMessage: (uuid, options) => {
    // An explicit target outranks a saved scroll position (plan §4.3).
    set({
      targetMessageUuid: uuid,
      shouldHighlightTarget: true,
      targetRequest: get().targetRequest + 1,
      pendingAnchor: null,
    });

    const session = get().selectedSession;
    const sessionId = session?.actual_session_id || session?.session_id;
    if (sessionId) {
      writeWebUIDeepLink(
        { sessionId, messageId: uuid },
        options?.history ?? "push",
      );
    }
  },

  clearTargetMessage: () =>
    set({
      targetMessageUuid: null,
      shouldHighlightTarget: false,
      targetRequest: get().targetRequest + 1,
    }),

  lookUpTargetMessage: async () => {
    const uuid = get().targetMessageUuid;
    if (!uuid) return false;
    // Taken before the await: this lookup owns the target it was started for.
    const request = get().targetRequest;
    const owns = () => get().targetRequest === request;
    const found = await get().ensureMessageLoaded(uuid);
    if (!found && owns()) get().clearTargetMessage();
    return found;
  },
});
