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
 *    awaits, and the screen is committed at once.
 * 2. The project and session loads it starts check the epoch after every
 *    await; a newer navigation makes them stop, so a slow load can no longer
 *    land on top of a later choice.
 * 3. Only then are the message target and the back/forward history written.
 *
 * Reloading what is on screen is not navigation: the watcher, filter toggles,
 * the header refresh and the restore after a screen switch use
 * `reloadCurrent` (message slice), which never changes the place and never
 * advances the epoch.
 */
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import type { ClaudeMessage, ClaudeProject, ClaudeSession } from "../../types";
import {
  type WebUIHistoryMode,
  type WebUINavigationOptions,
  writeWebUIDeepLink,
} from "@/utils/webuiDeepLink";
import { toast } from "sonner";
import i18n from "@/i18n";
import {
  isProjectView,
  placeOf,
  samePlace,
  viewAfterLeavingProject,
  type Place,
  type PlaceFallback,
  type View,
} from "@/navigation/place";
import { INITIAL_PAGINATION } from "./messageSlice";

/** Where a navigation goes. Omitted fields keep the current context. */
export interface NavigateTarget {
  /**
   * The screen. Omitted: keep the current one (dropping the project still
   * moves a project screen back to the conversation screen).
   */
  view?: View;
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
}

/** One back/forward history entry: the place plus its explicit target. */
export interface PlaceHistoryEntry {
  view: View;
  project: ClaudeProject | null;
  session: ClaudeSession | null;
  messageId: string | null;
}

export const PLACE_HISTORY_LIMIT = 50;

export interface NavigationSliceState {
  /** The screen of the current place. */
  view: View;
  /**
   * Advances on every navigation. Async work started by a navigation compares
   * against it and gives up once a newer one has begun.
   */
  navigationEpoch: number;
  placeHistory: { back: PlaceHistoryEntry[]; forward: PlaceHistoryEntry[] };
  targetMessageUuid: string | null;
  shouldHighlightTarget: boolean;
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
}

export type NavigationSlice = NavigationSliceState & NavigationSliceActions;

/** The current place: the screen plus the context the sidebar holds. */
export function selectPlace(state: FullAppStore): Place {
  return placeOf(state.view, state.selectedProject, state.selectedSession);
}

const entryOf = (state: FullAppStore): PlaceHistoryEntry => ({
  view: state.view,
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
  placeOf(entry.view, entry.project, entry.session);

export const initialNavigationState: NavigationSliceState = {
  view: "conversation",
  navigationEpoch: 0,
  placeHistory: { back: [], forward: [] },
  targetMessageUuid: null,
  shouldHighlightTarget: false,
};

export const createNavigationSlice: StateCreator<
  FullAppStore,
  [],
  [],
  NavigationSlice
> = (set, get) => ({
  ...initialNavigationState,

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
    const isCurrent = () => get().navigationEpoch === epoch;
    const history = options.history ?? "push";
    const from = entryOf(start);

    // Board hover is a property of the board screen, not of a place.
    set({ navigationEpoch: epoch, boardHoverSession: null });

    const openProject = start.selectedProject;
    const dropsProject = target.project === null && openProject !== null;
    const opensProject =
      target.project != null && target.project.path !== openProject?.path;

    // `empty` is where a fallback lands, never a screen to stay on: a move
    // that names no screen goes to the conversation from there.
    const kept = start.view === "empty" ? "conversation" : start.view;
    let view = target.view ?? kept;
    if (dropsProject) {
      get().clearProjectSelection({ history });
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
    set({ view });

    // The URL changes together with the selection it mirrors. Opening a
    // project drops the open session at once (`selectProject`), so the URL
    // drops it here too, before the first await: a navigation cancelled
    // during the project load must not leave the outgoing session in it.
    let sessionHistory = history;
    if (opensProject) {
      writeWebUIDeepLink({ sessionId: null, messageId: null }, history);
      // The session written next refines this entry rather than adding one.
      if (history === "push") sessionHistory = "replace";
      await get().selectProject(target.project as ClaudeProject);
      if (!isCurrent()) return false;
    }

    if (target.session) {
      await get().selectSession(target.session, {
        history: sessionHistory,
        cachedMessages: target.sessionMessages,
      });
      if (!isCurrent()) return false;
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
      writeWebUIDeepLink({ sessionId: null, messageId: null }, history);
    }

    // The explicit target belongs to its session. `messageId` omitted keeps
    // it (a screen switch), `null` drops it, and opening another session
    // drops it unless the move names a new one.
    // A session or project write above already pushed this move's entry; the
    // target refines it rather than adding a second one.
    const wroteUrl = Boolean(target.session) || opensProject;
    const targetHistory: WebUIHistoryMode =
      wroteUrl && history !== "none" ? "replace" : history;
    const changedSession =
      from.session?.file_path !== get().selectedSession?.file_path;
    if (typeof target.messageId === "string") {
      get().navigateToMessage(target.messageId, { history: targetHistory });
    } else if (target.messageId === null || changedSession) {
      get().clearTargetMessage();
      const session = get().selectedSession;
      if (session) {
        writeWebUIDeepLink(
          {
            sessionId: session.actual_session_id || session.session_id,
            messageId: null,
          },
          targetHistory,
        );
      }
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
    set({
      targetMessageUuid: uuid,
      shouldHighlightTarget: true,
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
    }),
});
