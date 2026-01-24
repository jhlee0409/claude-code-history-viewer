/**
 * Metadata Slice
 *
 * Manages user metadata stored in ~/.claude-history-viewer/user-data.json
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  UserMetadata,
  SessionMetadata,
  ProjectMetadata,
  UserSettings,
} from "../../types";
import { DEFAULT_USER_METADATA } from "../../types";
import { matchGlobPattern } from "../../utils/globUtils";
import type { StoreSet, StoreGet, FullAppStore } from "./types";

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

export const createMetadataSlice = (
  set: StoreSet<FullAppStore>,
  get: StoreGet<FullAppStore>
): MetadataSlice => ({
  ...initialMetadataState,

  loadMetadata: async () => {
    set({ isMetadataLoading: true, metadataError: null });

    try {
      const metadata = await invoke<UserMetadata>("load_user_metadata");
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
      await invoke("save_user_metadata", { metadata: userMetadata });
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
      const updatedMetadata = await invoke<UserMetadata>(
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
      const updatedMetadata = await invoke<UserMetadata>(
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
      const updatedMetadata = await invoke<UserMetadata>("update_user_settings", {
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

  clearMetadataError: () => {
    set({ metadataError: null });
  },
});
