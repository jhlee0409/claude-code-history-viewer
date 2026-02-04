/**
 * Watcher Slice
 *
 * Manages file watcher state and triggers data refresh.
 */

import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

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

// ============================================================================
// Slice Creator
// ============================================================================

export const createWatcherSlice: StateCreator<
  FullAppStore,
  [],
  [],
  WatcherSlice
> = (set, get) => ({
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
    const { selectedProject, selectProject } = get();

    // If this is the currently selected project, reload its sessions
    if (selectedProject && selectedProject.path === projectPath) {
      await selectProject(selectedProject);
    }

    // Mark as updated
    get().markProjectUpdated(projectPath);
  },

  triggerSessionRefresh: async (projectPath, sessionPath) => {
    const { selectedSession, selectSession } = get();

    // If this is the currently selected session, reload its messages
    if (selectedSession && selectedSession.file_path === sessionPath) {
      await selectSession(selectedSession);
    }

    // Mark project as updated
    get().markProjectUpdated(projectPath);
  },
});
