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
  groupProjectsByDirectory,
  type WorktreeGroupingResult,
  type DirectoryGroupingResult,
} from "../../utils/worktreeUtils";
import type { GroupingMode } from "../../types/metadata.types";

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
  getDirectoryGroupedProjects: () => DirectoryGroupingResult;
  getEffectiveGroupingMode: () => GroupingMode;
}

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialProjectState: ProjectSliceState = {
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
            await get().detectProviders();
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
      await get().detectProviders();
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
    const { claudePath, activeProviders } = get();
    if (!claudePath) return;

    set({ isLoadingProjects: true, error: null });
    try {
      const start = performance.now();
      const hasNonClaudeProviders = activeProviders.some((p) => p !== "claude");
      const projects = hasNonClaudeProviders
        ? await invoke<ClaudeProject[]>("scan_all_projects", {
            claudePath,
            activeProviders,
          })
        : await invoke<ClaudeProject[]>("scan_projects", {
            claudePath,
          });
      const duration = performance.now() - start;
      if (import.meta.env.DEV) {
        console.log(
          `[Frontend] scanProjects: ${projects.length}개 프로젝트, ${duration.toFixed(1)}ms`
        );
      }
      set({ projects });

      // Auto-enable worktree grouping if worktrees are detected
      // Only auto-enable if user has never explicitly set the preference
      const { userMetadata, updateUserSettings } = get();
      const worktreeGrouping = userMetadata?.settings?.worktreeGrouping ?? false;
      const userHasSet = userMetadata?.settings?.worktreeGroupingUserSet ?? false;
      if (!worktreeGrouping && !userHasSet && projects.length > 0) {
        const { groups } = detectWorktreeGroupsHybrid(projects);
        if (groups.length > 0) {
          // Worktrees detected - auto-enable grouping
          await updateUserSettings({ worktreeGrouping: true });
          if (import.meta.env.DEV) {
            console.log(
              `[Worktree] Auto-enabled grouping: ${groups.length} groups detected`
            );
          }
        }
      }
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
      const provider = project.provider ?? "claude";
      const sessions = provider !== "claude"
        ? await invoke<ClaudeSession[]>("load_provider_sessions", {
            provider,
            projectPath: project.path,
            excludeSidechain: get().excludeSidechain,
          })
        : await invoke<ClaudeSession[]>("load_project_sessions", {
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
    const { projects, userMetadata, isProjectHidden } = get();
    const settings = userMetadata?.settings;

    // Determine effective grouping mode (same logic as getEffectiveGroupingMode)
    const effectiveMode = settings?.groupingMode ?? (settings?.worktreeGrouping ? "worktree" : "none");

    // Filter out hidden projects first (use actual_path for pattern matching)
    const visibleProjects = projects.filter((p) => !isProjectHidden(p.actual_path));

    // Only group when worktree mode is active
    if (effectiveMode !== "worktree") {
      // When worktree grouping is disabled, return all visible projects as ungrouped
      return { groups: [], ungrouped: visibleProjects };
    }

    // Use hybrid detection: git-based (100% accurate) + heuristic fallback
    const result = detectWorktreeGroupsHybrid(visibleProjects);

    // Filter hidden children from worktree groups
    const filtered = result.groups.map((group) => ({
      ...group,
      children: group.children.filter((child) => !isProjectHidden(child.actual_path)),
    }));

    // Keep groups with visible children; rescue orphaned parents to ungrouped
    // (only if the parent itself is not hidden)
    result.groups = filtered.filter((group) => group.children.length > 0);
    const orphanedParents = filtered
      .filter((group) => group.children.length === 0)
      .map((group) => group.parent)
      .filter((parent) => !isProjectHidden(parent.actual_path));
    result.ungrouped = [...result.ungrouped, ...orphanedParents];

    return result;
  },

  getDirectoryGroupedProjects: () => {
    const { projects, isProjectHidden } = get();

    // Filter out hidden projects first (use actual_path for pattern matching)
    const visibleProjects = projects.filter((p) => !isProjectHidden(p.actual_path));

    return groupProjectsByDirectory(visibleProjects);
  },

  getEffectiveGroupingMode: (): GroupingMode => {
    const { userMetadata } = get();
    const settings = userMetadata?.settings;

    // If explicit groupingMode is set, use it
    if (settings?.groupingMode) {
      return settings.groupingMode;
    }

    // Legacy: if worktreeGrouping is true, use "worktree" mode
    if (settings?.worktreeGrouping) {
      return "worktree";
    }

    return "none";
  },
});
