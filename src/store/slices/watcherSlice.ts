/**
 * Watcher Slice
 *
 * Manages file watcher state and triggers data refresh.
 */

import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import { AppErrorType } from "../../types";

// ============================================================================
// State Interface
// ============================================================================

export interface WatcherSliceState {
  watcherEnabled: boolean;
  lastUpdateTime: Record<string, number>; // projectPath -> timestamp
}

export interface WatcherSliceActions {
  setWatcherEnabled: (enabled: boolean) => void;
  markProjectUpdated: (projectPath: string) => void;
  triggerProjectRefresh: (projectPath: string) => Promise<void>;
  triggerSessionRefresh: (
    projectPath: string,
    sessionPath: string
  ) => Promise<void>;
}

export type WatcherSlice = WatcherSliceState & WatcherSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialWatcherState: WatcherSliceState = {
  watcherEnabled: true,
  lastUpdateTime: {},
};

const PROJECT_UPDATE_DEBOUNCE_MS = 250;
const SESSION_REFRESH_QUIET_MS = 1500;

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

  const scheduleProjectUpdated = (projectPath: string) => {
    if (projectUpdateTimers.has(projectPath)) {
      return;
    }

    const timer = setTimeout(() => {
      projectUpdateTimers.delete(projectPath);
      get().markProjectUpdated(projectPath);
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

  const flushSessionRefresh = (sessionPath: string) => {
    clearSessionRefreshTimers(sessionPath);
    const queuedProjectPath = queuedSessionRefreshes.get(sessionPath);
    if (!queuedProjectPath) {
      return;
    }

    queuedSessionRefreshes.delete(sessionPath);
    void runSessionRefresh(queuedProjectPath, sessionPath);
  };

  const scheduleSessionRefresh = (projectPath: string, sessionPath: string) => {
    scheduleProjectUpdated(projectPath);

    const selectedSession = get().selectedSession;
    if (!selectedSession || selectedSession.file_path !== sessionPath) {
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

    const quietTimer = setTimeout(() => {
      flushSessionRefresh(sessionPath);
    }, SESSION_REFRESH_QUIET_MS);
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

    try {
      await get().selectSession(selectedSession);
    } catch (error) {
      get().setError({
        type: AppErrorType.UNKNOWN,
        message: `Failed to refresh session: ${String(error)}`,
      });
    } finally {
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

    markProjectUpdated: (projectPath) =>
      set((state) => ({
        lastUpdateTime: {
          ...state.lastUpdateTime,
          [projectPath]: Date.now(),
        },
      })),

    triggerProjectRefresh: async (projectPath) => {
      try {
        const { selectedProject, selectProject } = get();

        // If this is the currently selected project, reload its sessions
        if (selectedProject && selectedProject.path === projectPath) {
          await selectProject(selectedProject);
        }
      } catch (error) {
        get().setError({
          type: AppErrorType.UNKNOWN,
          message: `Failed to refresh project: ${String(error)}`,
        });
      } finally {
        // Always mark as updated regardless of success/failure
        get().markProjectUpdated(projectPath);
      }
    },

    triggerSessionRefresh: async (projectPath, sessionPath) =>
      scheduleSessionRefresh(projectPath, sessionPath),
  };
};
