/**
 * Watcher Slice
 *
 * Manages file watcher state and triggers data refresh.
 */

import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import { ownWork } from "@/navigation/ownership";
import { toast } from "sonner";
import i18n from "../../i18n";
import { errorDetail } from "@/utils/errorDetail";

// ============================================================================
// State Interface
// ============================================================================

export interface WatcherSliceState {
  watcherEnabled: boolean;
  lastUpdateTime: Record<string, number>; // projectPath -> timestamp
  activeSessionNearBottom: boolean;
}

export interface WatcherSliceActions {
  setWatcherEnabled: (enabled: boolean) => void;
  markProjectUpdated: (projectPath: string) => void;
  triggerProjectRefresh: (projectPath: string) => Promise<void>;
  triggerSessionRefresh: (
    projectPath: string,
    sessionPath: string
  ) => Promise<void>;
  setActiveSessionNearBottom: (nearBottom: boolean) => void;
}

export type WatcherSlice = WatcherSliceState & WatcherSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialWatcherState: WatcherSliceState = {
  watcherEnabled: true,
  lastUpdateTime: {},
  activeSessionNearBottom: true,
};

const PROJECT_UPDATE_DEBOUNCE_MS = 250;
const SESSION_REFRESH_QUIET_MS = 1500;
const SESSION_REFRESH_MIN_INTERVAL_MS = 5000;

/**
 * DB-backed providers (OpenCode's SQLite store) cannot attribute a write to a
 * single project/session at the filesystem level, so the watcher emits a
 * wildcard such as `opencode://*` meaning "refresh all OpenCode data"
 * (`src-tauri/src/commands/watcher.rs`). Strict-equality matching against the
 * selection discarded every one of those events (#566), so resolve a wildcard
 * to the current selection when it falls under the same prefix.
 */
const resolveWildcard = (
  pattern: string,
  selected: string | undefined
): string => {
  if (!pattern.endsWith("/*")) {
    return pattern;
  }
  const prefix = pattern.slice(0, -1);
  return selected && selected.startsWith(prefix) ? selected : pattern;
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createWatcherSlice: StateCreator<
  FullAppStore,
  [],
  [],
  WatcherSlice
> = (set, get) => {
  const projectUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const sessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const sessionRefreshInFlight = new Set<string>();
  const queuedSessionRefreshes = new Map<string, string>();
  const deferredSessionRefreshes = new Map<string, string>();
  const lastSessionRefreshAt = new Map<string, number>();

  const scheduleProjectUpdated = (projectPath: string) => {
    if (projectUpdateTimers.has(projectPath)) {
      return;
    }

    const timer = setTimeout(() => {
      projectUpdateTimers.delete(projectPath);
      // Reload the project's session list (not just a timestamp) so that a
      // newly-created session file — e.g. a Claude Code auto-continuation —
      // shows up, and superseded-chain-predecessor filtering on the backend
      // re-runs with the new file present. `triggerProjectRefresh` is a
      // no-op beyond marking the timestamp when `projectPath` isn't the
      // currently selected project, so this is safe to call unconditionally.
      void get().triggerProjectRefresh(projectPath);
    }, PROJECT_UPDATE_DEBOUNCE_MS);

    projectUpdateTimers.set(projectPath, timer);
  };

  const clearSessionRefreshTimers = (sessionPath: string) => {
    const quietTimer = sessionRefreshTimers.get(sessionPath);
    if (quietTimer) {
      clearTimeout(quietTimer);
      sessionRefreshTimers.delete(sessionPath);
    }
  };

  /**
   * A refresh's failure is feedback: only while it still owns the place, and
   * as a notification - the place is one tab's, so never the app's error
   * screen. (A session or project that is gone is the tab's own notice,
   * raised by the loaders themselves.)
   */
  const reportRefreshError = (owns: () => boolean, error: unknown) => {
    if (!owns()) return;
    toast.error(i18n.t("error.refreshFailed", { detail: errorDetail(error) }));
  };

  const flushSessionRefresh = async (sessionPath: string) => {
    clearSessionRefreshTimers(sessionPath);
    const queuedProjectPath = queuedSessionRefreshes.get(sessionPath);
    if (!queuedProjectPath) {
      return;
    }

    queuedSessionRefreshes.delete(sessionPath);
    const owner = ownWork(get, { context: { sessionPath } });
    try {
      await runSessionRefresh(queuedProjectPath, sessionPath);
    } catch (error) {
      reportRefreshError(owner.ownsFeedback, error);
    }
  };

  const scheduleSessionRefresh = (projectPath: string, sessionPath: string) => {
    scheduleProjectUpdated(projectPath);

    const selectedSession = get().selectedSession;
    if (!selectedSession || selectedSession.file_path !== sessionPath) {
      return Promise.resolve();
    }

    if (get().messages.length > 0 && !get().activeSessionNearBottom) {
      deferredSessionRefreshes.set(sessionPath, projectPath);
      clearSessionRefreshTimers(sessionPath);
      return Promise.resolve();
    }

    queuedSessionRefreshes.set(sessionPath, projectPath);
    if (sessionRefreshInFlight.has(sessionPath)) {
      return Promise.resolve();
    }

    const existingQuietTimer = sessionRefreshTimers.get(sessionPath);
    if (existingQuietTimer) {
      clearTimeout(existingQuietTimer);
    }

    const elapsedSinceLastRefresh =
      Date.now() - (lastSessionRefreshAt.get(sessionPath) ?? 0);
    const delay = Math.max(
      SESSION_REFRESH_QUIET_MS,
      SESSION_REFRESH_MIN_INTERVAL_MS - elapsedSinceLastRefresh
    );

    const quietTimer = setTimeout(() => {
      void (async () => {
        const owner = ownWork(get, { context: { sessionPath } });
        try {
          await flushSessionRefresh(sessionPath);
        } catch (error) {
          reportRefreshError(owner.ownsFeedback, error);
        }
      })();
    }, delay);
    sessionRefreshTimers.set(sessionPath, quietTimer);

    return Promise.resolve();
  };

  const runSessionRefresh = async (
    projectPath: string,
    sessionPath: string
  ) => {
    if (sessionRefreshInFlight.has(sessionPath)) {
      queuedSessionRefreshes.set(sessionPath, projectPath);
      return;
    }

    const selectedSession = get().selectedSession;
    if (!selectedSession || selectedSession.file_path !== sessionPath) {
      return;
    }

    sessionRefreshInFlight.add(sessionPath);
    const owner = ownWork(get, { context: { sessionPath } });

    try {
      await get().reloadCurrent("watcher");
    } catch (error) {
      reportRefreshError(owner.ownsFeedback, error);
    } finally {
      lastSessionRefreshAt.set(sessionPath, Date.now());
      sessionRefreshInFlight.delete(sessionPath);

      const queuedProjectPath = queuedSessionRefreshes.get(sessionPath);
      queuedSessionRefreshes.delete(sessionPath);
      if (
        queuedProjectPath &&
        get().selectedSession?.file_path === sessionPath
      ) {
        void scheduleSessionRefresh(queuedProjectPath, sessionPath);
      }
    }
  };

  return {
    ...initialWatcherState,

    setWatcherEnabled: (enabled) => set({ watcherEnabled: enabled }),

    setActiveSessionNearBottom: (nearBottom) => {
      if (get().activeSessionNearBottom === nearBottom) {
        return;
      }

      set({ activeSessionNearBottom: nearBottom });

      const selectedSession = get().selectedSession;
      if (!selectedSession) {
        return;
      }

      const sessionPath = selectedSession.file_path;

      if (!nearBottom) {
        const queuedProjectPath = queuedSessionRefreshes.get(sessionPath);
        if (queuedProjectPath) {
          deferredSessionRefreshes.set(sessionPath, queuedProjectPath);
          queuedSessionRefreshes.delete(sessionPath);
        }
        clearSessionRefreshTimers(sessionPath);
        return;
      }

      const projectPath = deferredSessionRefreshes.get(sessionPath);
      if (!projectPath) {
        return;
      }

      deferredSessionRefreshes.delete(sessionPath);
      void scheduleSessionRefresh(projectPath, sessionPath);
    },

    markProjectUpdated: (projectPath) =>
      set((state) => ({
        lastUpdateTime: {
          ...state.lastUpdateTime,
          [projectPath]: Date.now(),
        },
      })),

    triggerProjectRefresh: async (projectPath) => {
      const owner = ownWork(get, { context: { projectPath } });
      try {
        const { selectedProject, reloadProjectSessions } = get();

        // A session file changed, so the Edits screen's rows for this project
        // describe the state before that write. The reload below refreshes
        // the session list but never touches them, so without this the next
        // visit would serve pre-edit rows for as long as the project stays
        // selected, with the header refresh button the only way out.
        get().invalidateRecentEdits(projectPath);

        // Reload the selected project's sessions, keeping the open session
        // open. This used to call `selectProject`, which nulls
        // `selectedSession` because it is written for "the user picked a
        // different project" — so every write to an open session's JSONL
        // dropped the app to the empty state (#508).
        if (selectedProject && selectedProject.path === projectPath) {
          await reloadProjectSessions(selectedProject);
        }
      } catch (error) {
        reportRefreshError(owner.ownsFeedback, error);
      } finally {
        // Always mark as updated regardless of success/failure
        get().markProjectUpdated(projectPath);
      }
    },

    triggerSessionRefresh: async (projectPath, sessionPath) => {
      const { selectedProject, selectedSession } = get();
      return scheduleSessionRefresh(
        resolveWildcard(projectPath, selectedProject?.path),
        resolveWildcard(sessionPath, selectedSession?.file_path)
      );
    },
  };
};
