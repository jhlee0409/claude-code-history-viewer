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
  CustomClaudePath,
  WslSettings,
} from "../../types";
import { DEFAULT_USER_METADATA } from "../../types";
import { matchGlobPattern } from "../../utils/globUtils";
import type { FullAppStore } from "./types";
import type { ClaudeProject, ClaudeSession } from "../../types";
import { toast } from "sonner";
import i18n from "@/i18n";
import { favoritesMissingRef, libraryRefOf, projectListing } from "@/navigation/library";

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
  /**
   * Star or unstar a session (the sidebar's favourites, plan T7). Starring
   * records where the session lives (`ref`, with `project`: the project that
   * lists it, else the one `projectListing` finds); unstarring drops both. A
   * failed save is reported with a toast.
   */
  toggleSessionFavorite: (session: ClaudeSession, project?: ClaudeProject | null) => Promise<void>;
  /**
   * Give the stars among `sessions` that predate `ref` the location they
   * lack. Called when a project's sessions load.
   */
  backfillFavoriteRefs: (sessions: ClaudeSession[]) => Promise<void>;
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
  /** Add a custom Claude directory path */
  addCustomClaudePath: (path: string, label?: string) => Promise<void>;
  /** Remove a custom Claude directory path */
  removeCustomClaudePath: (path: string) => Promise<void>;
  /** Update label for a custom Claude directory path */
  updateCustomClaudePathLabel: (path: string, label: string) => Promise<void>;
  /** Enable or disable WSL scanning */
  setWslEnabled: (enabled: boolean) => Promise<void>;
  /** Toggle a WSL distro in/out of the excluded list */
  toggleWslDistro: (distroName: string) => Promise<void>;
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

/*
  Metadata writes go out one at a time (T7 review R3). Each request sends a
  whole record (session, project or settings), which the backend stores as
  is, and answers with the whole metadata. Two writes built from the same
  snapshot therefore lose one of them - a ref backfill used to write back a
  star the user had just removed - and an older answer could land over a
  newer one. Queued, each write reads the state the previous one left when
  its turn comes, and the answers arrive in order. A failed write does not
  stall the ones behind it; its own caller still sees the failure. One app
  store, so one queue.
*/
let writes: Promise<unknown> = Promise.resolve();
function inTurn<T>(write: () => Promise<T>): Promise<T> {
  const turn = writes.then(write);
  writes = turn.catch(() => undefined);
  return turn;
}

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

  saveMetadata: () =>
    inTurn(async () => {
      const { userMetadata } = get();

      try {
        await api("save_user_metadata", { metadata: userMetadata });
      } catch (error) {
        console.error("Failed to save user metadata:", error);
        set({ metadataError: String(error) });
      }
    }),

  updateSessionMetadata: (sessionId: string, update: Partial<SessionMetadata>) =>
    inTurn(async () => {
      const { userMetadata } = get();
      const existingSession = userMetadata.sessions[sessionId] || {};
      const mergedSession: SessionMetadata = { ...existingSession, ...update };

      try {
        const updatedMetadata = await api<UserMetadata>("update_session_metadata", {
          sessionId,
          update: mergedSession,
        });
        set({ userMetadata: updatedMetadata });
      } catch (error) {
        console.error("Failed to update session metadata:", error);
        set({ metadataError: String(error) });
      }
    }),

  // It toggles what the record holds when the write's turn comes.
  toggleSessionFavorite: (session: ClaudeSession, project?: ClaudeProject | null) => {
    const ref = libraryRefOf(session, project ?? projectListing(get(), session));
    return inTurn(async function toggleSessionFavorite() {
      const existing = get().userMetadata.sessions[session.session_id] ?? {};
      const update: SessionMetadata = existing.starred
        ? { ...existing, starred: undefined, ref: undefined }
        : { ...existing, starred: true, ref };
      try {
        const updatedMetadata = await api<UserMetadata>("update_session_metadata", {
          sessionId: session.session_id,
          update,
        });
        set({ userMetadata: updatedMetadata });
      } catch (error) {
        console.error("Failed to update favourite:", error);
        set({ metadataError: String(error) });
        toast.error(i18n.t("session.favorite.saveError"));
      }
    });
  },

  // The ref is taken now, while `sessions` is the list it came from. Whether
  // the session still needs it (starred, no ref) is decided at write time, so
  // an unstar made meanwhile is never undone.
  backfillFavoriteRefs: async (sessions: ClaudeSession[]) => {
    const pending = favoritesMissingRef(get().userMetadata, sessions).map((session) => ({
      sessionId: session.session_id,
      ref: libraryRefOf(session, projectListing(get(), session)),
    }));
    for (const { sessionId, ref } of pending) {
      await inTurn(async () => {
        const existing = get().userMetadata.sessions[sessionId];
        if (existing?.starred !== true || existing.ref) return;
        try {
          const updatedMetadata = await api<UserMetadata>("update_session_metadata", {
            sessionId,
            update: { ...existing, ref },
          });
          set({ userMetadata: updatedMetadata });
        } catch (error) {
          console.error("Failed to record a favourite's location:", error);
          set({ metadataError: String(error) });
        }
      });
    }
  },

  updateProjectMetadata: (projectPath: string, update: Partial<ProjectMetadata>) =>
    inTurn(async () => {
      const { userMetadata } = get();
      const existingProject = userMetadata.projects[projectPath] || {};
      const mergedProject: ProjectMetadata = { ...existingProject, ...update };

      try {
        const updatedMetadata = await api<UserMetadata>("update_project_metadata", {
          projectPath,
          update: mergedProject,
        });
        set({ userMetadata: updatedMetadata });
      } catch (error) {
        console.error("Failed to update project metadata:", error);
        set({ metadataError: String(error) });
      }
    }),

  updateUserSettings: (update: Partial<UserSettings>) =>
    inTurn(async () => {
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
        const message = String(error);
        set({ metadataError: message });
        throw new Error(message);
      }
    }),

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

  addCustomClaudePath: async (path: string, label?: string) => {
    const { userMetadata } = get();
    const currentPaths = userMetadata.settings.customClaudePaths ?? [];
    // Normalize: trim trailing slashes for consistent comparison
    const normalized = path.replace(/[\\/]+$/, "");
    // Prevent duplicates
    if (currentPaths.some((cp) => cp.path.replace(/[\\/]+$/, "") === normalized)) {
      return;
    }
    const entry: CustomClaudePath = { path: normalized, label };
    await get().updateUserSettings({
      customClaudePaths: [...currentPaths, entry],
    });
  },

  removeCustomClaudePath: async (path: string) => {
    const { userMetadata } = get();
    const currentPaths = userMetadata.settings.customClaudePaths ?? [];
    const normalized = path.replace(/[\\/]+$/, "");
    await get().updateUserSettings({
      customClaudePaths: currentPaths.filter(
        (cp) => cp.path.replace(/[\\/]+$/, "") !== normalized
      ),
    });
  },

  updateCustomClaudePathLabel: async (path: string, label: string) => {
    const { userMetadata } = get();
    const currentPaths = userMetadata.settings.customClaudePaths ?? [];
    const normalized = path.replace(/[\\/]+$/, "");
    await get().updateUserSettings({
      customClaudePaths: currentPaths.map((cp) =>
        cp.path.replace(/[\\/]+$/, "") === normalized
          ? { ...cp, label: label || undefined }
          : cp
      ),
    });
  },

  setWslEnabled: async (enabled: boolean) => {
    const current = get().userMetadata?.settings ?? {};
    const rawWsl = current.wsl;
    const wsl: WslSettings = {
      enabled: rawWsl?.enabled ?? false,
      excludedDistros: rawWsl?.excludedDistros ?? [],
    };
    await get().updateUserSettings({ wsl: { ...wsl, enabled } });
  },

  toggleWslDistro: async (distroName: string) => {
    const current = get().userMetadata?.settings ?? {};
    const rawWsl = current.wsl;
    const wsl: WslSettings = {
      enabled: rawWsl?.enabled ?? false,
      excludedDistros: rawWsl?.excludedDistros ?? [],
    };
    const excluded = wsl.excludedDistros.includes(distroName)
      ? wsl.excludedDistros.filter((d: string) => d !== distroName)
      : [...wsl.excludedDistros, distroName];
    await get().updateUserSettings({ wsl: { ...wsl, excludedDistros: excluded } });
  },

  clearMetadataError: () => {
    set({ metadataError: null });
  },
});
