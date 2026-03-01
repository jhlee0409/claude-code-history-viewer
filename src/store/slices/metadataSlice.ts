/**
 * Metadata Slice
 *
 * Manages user metadata stored in ~/.claude-history-viewer/user-data.json
 */

import { api } from "@/services/api";
import type { StateCreator } from "zustand";
import type {
  UserMetadata,
  SessionMetadata,
  ProjectMetadata,
  UserSettings,
} from "../../types";
import { DEFAULT_USER_METADATA } from "../../types";
import { matchGlobPattern } from "../../utils/globUtils";
import type { FullAppStore } from "./types";

// ============================================================================
// State Interface
// ============================================================================

export interface MetadataSliceState {
  /** User metadata from ~/.claude-history-viewer/user-data.json */
  userMetadata: UserMetadata;
  /** Whether metadata has been loaded */
  isMetadataLoaded: boolean;
  /** Whether metadata is currently loading */
  isMetadataLoading: boolean;
  /** Error message if metadata loading failed */
  metadataError: string | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface MetadataSliceActions {
  /** Load user metadata from disk */
  loadMetadata: () => Promise<void>;
  /** Save entire metadata to disk */
  saveMetadata: () => Promise<void>;
  /** Update metadata for a specific session */
  updateSessionMetadata: (
    sessionId: string,
    update: Partial<SessionMetadata>
  ) => Promise<void>;
  /** Update metadata for a specific project */
  updateProjectMetadata: (
    projectPath: string,
    update: Partial<ProjectMetadata>
  ) => Promise<void>;
  /** Update global user settings */
  updateUserSettings: (update: Partial<UserSettings>) => Promise<void>;
  /** Get session display name (custom name or fallback) */
  getSessionDisplayName: (
    sessionId: string,
    fallbackSummary?: string
  ) => string | undefined;
  /** Check if a project should be hidden */
  isProjectHidden: (projectPath: string) => boolean;
  /** Hide a specific project */
  hideProject: (projectPath: string) => Promise<void>;
  /** Unhide a specific project */
  unhideProject: (projectPath: string) => Promise<void>;
  /** Add a hidden pattern (glob) */
  addHiddenPattern: (pattern: string) => Promise<void>;
  /** Remove a hidden pattern */
  removeHiddenPattern: (pattern: string) => Promise<void>;
  /** Clear metadata error */
  clearMetadataError: () => void;
}

export type MetadataSlice = MetadataSliceState & MetadataSliceActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialMetadataState: MetadataSliceState = {
  userMetadata: DEFAULT_USER_METADATA,
  isMetadataLoaded: false,
  isMetadataLoading: false,
  metadataError: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createMetadataSlice: StateCreator<
  FullAppStore,
  [],
  [],
  MetadataSlice
> = (set, get) => ({
  ...initialMetadataState,

  loadMetadata: async () => {
    set({ isMetadataLoading: true, metadataError: null });

    try {
      const metadata = await api<UserMetadata>("load_user_metadata");
      set({
        userMetadata: metadata,
        isMetadataLoaded: true,
        isMetadataLoading: false,
      });
    } catch (error) {
      console.error("Failed to load user metadata:", error);
      set({
        userMetadata: DEFAULT_USER_METADATA,
        isMetadataLoaded: true,
        isMetadataLoading: false,
        metadataError: String(error),
      });
    }
  },

  saveMetadata: async () => {
    const { userMetadata } = get();

    try {
      await api("save_user_metadata", { metadata: userMetadata });
    } catch (error) {
      console.error("Failed to save user metadata:", error);
      set({ metadataError: String(error) });
    }
  },

  updateSessionMetadata: async (
    sessionId: string,
    update: Partial<SessionMetadata>
  ) => {
    const { userMetadata } = get();
    const existingSession = userMetadata.sessions[sessionId] || {};
    const mergedSession: SessionMetadata = { ...existingSession, ...update };

    try {
      const updatedMetadata = await api<UserMetadata>(
        "update_session_metadata",
        {
          sessionId,
          update: mergedSession,
        }
      );
      set({ userMetadata: updatedMetadata });
    } catch (error) {
      console.error("Failed to update session metadata:", error);
      set({ metadataError: String(error) });
    }
  },

  updateProjectMetadata: async (
    projectPath: string,
    update: Partial<ProjectMetadata>
  ) => {
    const { userMetadata } = get();
    const existingProject = userMetadata.projects[projectPath] || {};
    const mergedProject: ProjectMetadata = { ...existingProject, ...update };

    try {
      const updatedMetadata = await api<UserMetadata>(
        "update_project_metadata",
        {
          projectPath,
          update: mergedProject,
        }
      );
      set({ userMetadata: updatedMetadata });
    } catch (error) {
      console.error("Failed to update project metadata:", error);
      set({ metadataError: String(error) });
    }
  },

  updateUserSettings: async (update: Partial<UserSettings>) => {
    const { userMetadata } = get();
    const mergedSettings: UserSettings = {
      ...userMetadata.settings,
      ...update,
    };

    try {
      const updatedMetadata = await api<UserMetadata>("update_user_settings", {
        settings: mergedSettings,
      });
      set({ userMetadata: updatedMetadata });
    } catch (error) {
      console.error("Failed to update user settings:", error);
      set({ metadataError: String(error) });
    }
  },

  getSessionDisplayName: (
    sessionId: string,
    fallbackSummary?: string
  ): string | undefined => {
    const { userMetadata } = get();
    const sessionMeta = userMetadata.sessions[sessionId];
    return sessionMeta?.customName || fallbackSummary;
  },

  isProjectHidden: (projectPath: string): boolean => {
    const { userMetadata } = get();

    // Check explicit hidden flag
    const projectMeta = userMetadata.projects[projectPath];
    if (projectMeta?.hidden) {
      return true;
    }

    // Check hidden patterns
    const patterns = userMetadata.settings.hiddenPatterns || [];
    for (const pattern of patterns) {
      if (matchGlobPattern(projectPath, pattern)) {
        return true;
      }
    }

    return false;
  },

  hideProject: async (projectPath: string) => {
    await get().updateProjectMetadata(projectPath, { hidden: true });
  },

  unhideProject: async (projectPath: string) => {
    await get().updateProjectMetadata(projectPath, { hidden: false });
  },

  addHiddenPattern: async (pattern: string) => {
    const { userMetadata } = get();
    const currentPatterns = userMetadata.settings.hiddenPatterns || [];
    if (!currentPatterns.includes(pattern)) {
      await get().updateUserSettings({
        hiddenPatterns: [...currentPatterns, pattern],
      });
    }
  },

  removeHiddenPattern: async (pattern: string) => {
    const { userMetadata } = get();
    const currentPatterns = userMetadata.settings.hiddenPatterns || [];
    await get().updateUserSettings({
      hiddenPatterns: currentPatterns.filter((p) => p !== pattern),
    });
  },

  clearMetadataError: () => {
    set({ metadataError: null });
  },
});
