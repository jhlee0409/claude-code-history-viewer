/**
 * Project Slice
 *
 * Handles project/folder scanning and session listing.
 */

import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { ClaudeProject, ClaudeSession, AppError } from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import {
  detectWorktreeGroupsHybrid,
  type WorktreeGroupingResult,
} from "../../utils/worktreeUtils";

// ============================================================================
// State Interface
// ============================================================================

export interface ProjectSliceState {
  claudePath: string;
  projects: ClaudeProject[];
  selectedProject: ClaudeProject | null;
  sessions: ClaudeSession[];
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  error: AppError | null;
}

export interface ProjectSliceActions {
  initializeApp: () => Promise<void>;
  scanProjects: () => Promise<void>;
  selectProject: (project: ClaudeProject) => Promise<void>;
  setClaudePath: (path: string) => Promise<void>;
  setError: (error: AppError | null) => void;
  setSelectedSession: (session: ClaudeSession | null) => void;
  setSessions: (sessions: ClaudeSession[]) => void;
  getGroupedProjects: () => WorktreeGroupingResult;
}

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialProjectState: ProjectSliceState = {
  claudePath: "",
  projects: [],
  selectedProject: null,
  sessions: [],
  selectedSession: null,
  isLoading: false,
  isLoadingProjects: false,
  isLoadingSessions: false,
  error: null,
};

// ============================================================================
// Helper
// ============================================================================

const isTauriAvailable = () => {
  try {
    return typeof window !== "undefined" && typeof invoke === "function";
  } catch {
    return false;
  }
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createProjectSlice: StateCreator<
  FullAppStore,
  [],
  [],
  ProjectSlice
> = (set, get) => ({
  ...initialProjectState,

  initializeApp: async () => {
    set({ isLoading: true, error: null });
    try {
      if (!isTauriAvailable()) {
        throw new Error(
          "Tauri API를 사용할 수 없습니다. 데스크톱 앱에서 실행해주세요."
        );
      }

      // Try to load saved settings first
      try {
        const store = await load("settings.json", {
          autoSave: false,
          defaults: {},
        });
        const savedPath = await store.get<string>("claudePath");

        if (savedPath) {
          const isValid = await invoke<boolean>("validate_claude_folder", {
            path: savedPath,
          });
          if (isValid) {
            set({ claudePath: savedPath });
            await get().loadMetadata();
            await get().scanProjects();
            return;
          }
        }
      } catch {
        console.log("No saved settings found");
      }

      // Try default path
      const claudePath = await invoke<string>("get_claude_folder_path");
      set({ claudePath });
      await get().loadMetadata();
      await get().scanProjects();
    } catch (error) {
      console.error("Failed to initialize app:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      let errorType = AppErrorType.UNKNOWN;
      let message = errorMessage;

      if (errorMessage.includes("CLAUDE_FOLDER_NOT_FOUND:")) {
        errorType = AppErrorType.CLAUDE_FOLDER_NOT_FOUND;
        message = errorMessage.split(":")[1] || errorMessage;
      } else if (errorMessage.includes("PERMISSION_DENIED:")) {
        errorType = AppErrorType.PERMISSION_DENIED;
        message = errorMessage.split(":")[1] || errorMessage;
      } else if (errorMessage.includes("Tauri API")) {
        errorType = AppErrorType.TAURI_NOT_AVAILABLE;
      }

      set({ error: { type: errorType, message } });
    } finally {
      set({ isLoading: false });
    }
  },

  scanProjects: async () => {
    const { claudePath } = get();
    if (!claudePath) return;

    set({ isLoadingProjects: true, error: null });
    try {
      const start = performance.now();
      const projects = await invoke<ClaudeProject[]>("scan_projects", {
        claudePath,
      });
      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(
          `[Frontend] scanProjects: ${projects.length}개 프로젝트, ${duration.toFixed(1)}ms`
        );
      }
      set({ projects });
    } catch (error) {
      console.error("Failed to scan projects:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      set({ isLoadingProjects: false });
    }
  },

  selectProject: async (project: ClaudeProject) => {
    set({
      selectedProject: project,
      sessions: [],
      selectedSession: null,
      isLoadingSessions: true,
    });
    try {
      const sessions = await invoke<ClaudeSession[]>("load_project_sessions", {
        projectPath: project.path,
        excludeSidechain: get().excludeSidechain,
      });
      set({ sessions });
    } catch (error) {
      console.error("Failed to load project sessions:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      set({ isLoadingSessions: false });
    }
  },

  setClaudePath: async (path: string) => {
    set({ claudePath: path });

    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {},
      });
      await store.set("claudePath", path);
      await store.save();
    } catch (error) {
      console.error("Failed to save claude path:", error);
    }
  },

  setError: (error: AppError | null) => {
    set({ error });
  },

  setSelectedSession: (session: ClaudeSession | null) => {
    set({ selectedSession: session });
  },

  setSessions: (sessions: ClaudeSession[]) => {
    set({ sessions });
  },

  getGroupedProjects: () => {
    const { projects, userMetadata } = get();
    const worktreeGrouping = userMetadata?.settings?.worktreeGrouping ?? false;

    if (!worktreeGrouping) {
      // When grouping is disabled, return all projects as ungrouped
      return { groups: [], ungrouped: projects };
    }

    // Use hybrid detection: git-based (100% accurate) + heuristic fallback
    return detectWorktreeGroupsHybrid(projects);
  },
});
