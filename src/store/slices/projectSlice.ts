/**
 * Project Slice
 *
 * Handles project/folder scanning and session listing.
 */

import { api } from "@/services/api";
import { storageAdapter } from "@/services/storage";
import type { ClaudeProject, ClaudeSession, SessionPage, AppError, ProviderId, UserSettings } from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import { toast } from "sonner";
import i18n from "../../i18n";
import type { FullAppStore } from "./types";
import {
  detectWorktreeGroupsHybrid,
  groupProjectsByDirectory,
  type WorktreeGroupingResult,
  type DirectoryGroupingResult,
} from "../../utils/worktreeUtils";
import type { GroupingMode } from "../../types/metadata.types";
import {
  DEFAULT_PROVIDER_ID,
  getProviderId,
  normalizeProviderIds,
  PROVIDER_IDS,
} from "../../utils/providers";
import { INITIAL_PAGINATION } from "./messageSlice";
import { nextRequestId, getRequestId } from "../../utils/requestId";
import {
  type WebUINavigationOptions,
  writeWebUIDeepLink,
} from "../../utils/webuiDeepLink";

// ============================================================================
// State Interface
// ============================================================================

export interface ProjectSliceState {
  claudePath: string;
  projects: ClaudeProject[];
  selectedProject: ClaudeProject | null;
  sessions: ClaudeSession[];
  sessionsTotal: number;
  sessionsOffset: number;
  hasMoreSessions: boolean;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  isLoadingMoreSessions: boolean;
  isRefreshingAllConversations: boolean;
  error: AppError | null;
}

export interface ProjectSliceActions {
  initializeApp: () => Promise<void>;
  discoverProviders: () => Promise<void>;
  scanProjects: () => Promise<void>;
  refreshAllConversations: () => Promise<void>;
  selectProject: (project: ClaudeProject) => Promise<void>;
  reloadProjectSessions: (project: ClaudeProject) => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  clearProjectSelection: (options?: WebUINavigationOptions) => void;
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
  sessionsTotal: 0,
  sessionsOffset: 0,
  hasMoreSessions: false,
  selectedSession: null,
  isLoading: false,
  isLoadingProjects: false,
  isLoadingSessions: false,
  isLoadingMoreSessions: false,
  isRefreshingAllConversations: false,
  error: null,
};

const SESSION_PAGE_LIMIT = 250;

const dedupeSessionsById = (sessions: ClaudeSession[]): ClaudeSession[] => {
  const seen = new Set<string>();
  const deduped: ClaudeSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.session_id)) {
      continue;
    }
    seen.add(session.session_id);
    deduped.push(session);
  }
  return deduped;
};

// ============================================================================
// Helper
// ============================================================================

const isTauriAvailable = () => {
  try {
    return typeof window !== "undefined" && typeof api === "function";
  } catch {
    return false;
  }
};

const projectTimestamp = (project: ClaudeProject): number | null => {
  const timestamp = Date.parse(project.last_modified);
  return Number.isNaN(timestamp) ? null : timestamp;
};

const sortProjectsByLastModified = (projects: ClaudeProject[]): ClaudeProject[] =>
  [...projects].sort((a, b) => {
    const aTimestamp = projectTimestamp(a);
    const bTimestamp = projectTimestamp(b);
    if (aTimestamp != null && bTimestamp != null) {
      return bTimestamp - aTimestamp;
    }
    if (aTimestamp != null) {
      return -1;
    }
    if (bTimestamp != null) {
      return 1;
    }
    return b.last_modified.localeCompare(a.last_modified);
  });

const withProvider = (
  projects: ClaudeProject[],
  provider: ProviderId,
): ClaudeProject[] =>
  projects.map((project) => ({
    ...project,
    provider: project.provider ?? provider,
  }));

const isSameProject = (
  project: ClaudeProject,
  selectedProject: ClaudeProject,
): boolean =>
  project.path === selectedProject.path &&
  getProviderId(project.provider) === getProviderId(selectedProject.provider);

const isSameSession = (
  session: ClaudeSession,
  selectedSession: ClaudeSession,
): boolean =>
  session.file_path === selectedSession.file_path ||
  session.session_id === selectedSession.session_id ||
  session.actual_session_id === selectedSession.actual_session_id;

const scanProviderProjects = async ({
  provider,
  claudePath,
  customClaudePaths,
  settings,
}: {
  provider: ProviderId;
  claudePath: string;
  customClaudePaths: UserSettings["customClaudePaths"];
  settings: UserSettings | undefined;
}): Promise<ClaudeProject[]> => {
  const hasCustomPaths = customClaudePaths != null && customClaudePaths.length > 0;
  const wslEnabled = settings?.wsl?.enabled ?? false;

  if (provider === DEFAULT_PROVIDER_ID && !hasCustomPaths && !wslEnabled) {
    if (!claudePath) {
      return [];
    }
    const projects = await api<ClaudeProject[]>("scan_projects", {
      claudePath,
    });
    return withProvider(projects, provider);
  }

  const projects = await api<ClaudeProject[]>("scan_all_projects", {
    ...(claudePath && { claudePath }),
    activeProviders: [provider],
    ...(provider === DEFAULT_PROVIDER_ID && hasCustomPaths
      ? { customClaudePaths }
      : {}),
    ...(provider === DEFAULT_PROVIDER_ID
      ? {
          wslEnabled,
          wslExcludedDistros: settings?.wsl?.excludedDistros ?? [],
        }
      : {}),
  });
  return withProvider(projects, provider);
};

// ============================================================================
// CLAUDE_CONFIG_DIR Auto-detection
// ============================================================================

/** Auto-register CLAUDE_CONFIG_DIR as a custom directory if not already present. */
async function autoRegisterConfigDir(get: () => FullAppStore): Promise<void> {
  try {
    if (get().isServerReadOnly) return;

    const detected = await api<string | null>("detect_claude_config_dir");
    if (!detected) return;

    const normalize = (p: string) => p.replace(/[\\/]+$/, "");
    const normalizedDetected = normalize(detected);
    const existing = get().userMetadata?.settings?.customClaudePaths ?? [];
    const alreadyRegistered = existing.some((cp) => normalize(cp.path) === normalizedDetected);
    if (alreadyRegistered) return;

    await get().addCustomClaudePath(detected, "CLAUDE_CONFIG_DIR");
  } catch {
    if (import.meta.env.DEV) {
      console.warn("[autoRegisterConfigDir] Failed to detect CLAUDE_CONFIG_DIR");
    }
  }
}

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
      await get().loadServerConfig();

      if (!isTauriAvailable()) {
        throw new Error(
          "Tauri API를 사용할 수 없습니다. 데스크톱 앱에서 실행해주세요."
        );
      }

      // Load metadata before resolving the Claude path so an explicit provider
      // discovery choice can restore non-Claude projects on startup without
      // running the broad provider detector again.
      await get().loadMetadata();
      const savedProviderIds = normalizeProviderIds(
        get().userMetadata?.settings?.discoveredProviderIds ?? []
      );
      if (savedProviderIds.length > 0) {
        get().setActiveProviders(savedProviderIds);
      }
      const hasSavedNonClaudeProviders = savedProviderIds.some(
        (provider) => provider !== DEFAULT_PROVIDER_ID
      );
      const savedSettings = get().userMetadata?.settings;
      const hasCustomClaudePaths =
        (savedSettings?.customClaudePaths?.length ?? 0) > 0;
      const hasWslSource = savedSettings?.wsl?.enabled ?? false;
      const hasConfiguredScanSource =
        hasSavedNonClaudeProviders || hasCustomClaudePaths || hasWslSource;

      // Try to load saved settings first
      try {
        const store = await storageAdapter.load("settings.json", {
          autoSave: false,
          defaults: {},
        });
        const savedPath = await store.get<string>("claudePath");

        if (savedPath) {
          const isValid = await api<boolean>("validate_claude_folder", {
            path: savedPath,
          });
          if (isValid) {
            set({ claudePath: savedPath });
            await get().scanProjects();
            return;
          }
        }
      } catch {
        console.log("No saved settings found");
      }

      // Try the default Claude path. Provider discovery is intentionally not
      // part of startup: scanning every supported provider can touch protected
      // user folders before the user has asked to browse them.
      try {
        const claudePath = await api<string>("get_claude_folder_path");
        set({ claudePath });
        await get().scanProjects();
        return;
      } catch (claudeFolderError) {
        const claudeErrorMessage =
          claudeFolderError instanceof Error
            ? claudeFolderError.message
            : String(claudeFolderError);
        if (!claudeErrorMessage.includes("CLAUDE_FOLDER_NOT_FOUND:")) {
          throw claudeFolderError;
        }

        // A user who previously opted in to another provider (or configured a
        // custom Claude/WSL source) should not be forced through the Claude
        // folder picker on every launch.
        if (hasConfiguredScanSource) {
          await get().scanProjects();
          return;
        }

        throw claudeFolderError;
      }
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

  // Explicitly opt in to discovery of other providers and custom Claude
  // locations. This is the only path that calls the broad provider detector.
  discoverProviders: async () => {
    set({ error: null });
    const detected = await get().detectProviders();
    if (!detected) {
      // Detection failures are already surfaced by providerSlice. Continue
      // with the last persisted/detected provider state without overwriting
      // it with an empty discovery result.
      await get().scanProjects();
      return;
    }
    await autoRegisterConfigDir(get);
    const discoveredProviderIds = normalizeProviderIds(
      get().providers
        .filter((provider) => provider.is_available)
        .map((provider) => provider.id as ProviderId)
    );
    try {
      await get().updateUserSettings({ discoveredProviderIds });
    } catch (error) {
      // Provider discovery should still show the current result if metadata
      // persistence is unavailable; the next explicit discovery can retry it.
      console.error("Failed to persist discovered providers:", error);
      toast.error(i18n.t("common.provider.saveError"));
    }
    await get().scanProjects();
  },

  // Provider discovery is empty during first startup, so the initial scan is
  // limited to the default provider. Once the user explicitly discovers
  // providers, the detected IDs (or their persisted IDs after restart) become
  // the scan candidate list while `activeProviders` remains a client-side
  // filter. Provider scans are launched independently so a slow provider does
  // not block fast providers from appearing in the sidebar.
  scanProjects: async () => {
    const requestId = nextRequestId("scanProjects");
    const { claudePath, providers, activeProviders } = get();
    const customClaudePaths = get().userMetadata?.settings?.customClaudePaths;
    const hasCustomPaths = customClaudePaths != null && customClaudePaths.length > 0;
    const settings = get().userMetadata?.settings;
    const wslEnabled = settings?.wsl?.enabled ?? false;
    const detectedProviderIds = normalizeProviderIds(
      providers
        .filter((provider) => provider.is_available)
        .map((provider) => provider.id as ProviderId)
    );
    const persistedProviderIds = normalizeProviderIds(
      settings?.discoveredProviderIds ?? []
    );
    const requestedProviderIds = normalizeProviderIds(activeProviders);
    const providerSet = new Set<ProviderId>(
      detectedProviderIds.length > 0
        ? detectedProviderIds
        : persistedProviderIds.length > 0
          ? persistedProviderIds
        : requestedProviderIds.length > 0
          ? requestedProviderIds
          : [DEFAULT_PROVIDER_ID]
    );
    if (claudePath || hasCustomPaths || wslEnabled) {
      providerSet.add(DEFAULT_PROVIDER_ID);
    }
    const scanProviders = PROVIDER_IDS.filter((provider) => providerSet.has(provider));
    const hasNonClaudeProviders = scanProviders.some((provider) => provider !== DEFAULT_PROVIDER_ID);
    // Allow scanning when at least one source is available: a saved Claude path,
    // a custom Claude path, WSL, or any non-Claude provider detected on disk (#222).
    if (!claudePath && !hasCustomPaths && !wslEnabled && !hasNonClaudeProviders) return;

    set({ isLoadingProjects: true, error: null });
    try {
      const start = performance.now();
      const settings = get().userMetadata?.settings;
      const previouslyLoadedProjects = get().projects.filter((project) =>
        scanProviders.includes(getProviderId(project.provider))
      );
      const loadedProviders = new Set<ProviderId>();
      const projectsByProvider = new Map<ProviderId, ClaudeProject[]>();
      const providerErrors: string[] = [];

      const publishPartialResults = () => {
        const pendingPreviousProjects = previouslyLoadedProjects.filter(
          (project) => !loadedProviders.has(getProviderId(project.provider))
        );
        const loadedProjects = Array.from(projectsByProvider.values()).flat();
        set({
          projects: sortProjectsByLastModified([
            ...pendingPreviousProjects,
            ...loadedProjects,
          ]),
        });
      };

      await Promise.all(
        scanProviders.map(async (provider) => {
          try {
            const providerProjects = await scanProviderProjects({
              provider,
              claudePath,
              customClaudePaths,
              settings,
            });
            if (requestId !== getRequestId("scanProjects")) {
              return;
            }
            loadedProviders.add(provider);
            projectsByProvider.set(provider, providerProjects);
            publishPartialResults();
          } catch (scanError) {
            const message = scanError instanceof Error
              ? scanError.message
              : String(scanError);
            providerErrors.push(`${provider}: ${message}`);
            if (import.meta.env.DEV) {
              console.warn(`[Frontend] ${provider} project scan failed:`, scanError);
            }
          }
        })
      );

      const duration = performance.now() - start;
      const projects = sortProjectsByLastModified(
        Array.from(projectsByProvider.values()).flat()
      );
      if (import.meta.env.DEV) {
        console.log(
          `[Frontend] scanProjects: ${projects.length}개 프로젝트, ${duration.toFixed(1)}ms`
        );
      }
      if (requestId !== getRequestId("scanProjects")) {
        return;
      }
      set({ projects });
      if (projects.length === 0 && providerErrors.length > 0) {
        set({
          error: {
            type: AppErrorType.UNKNOWN,
            message: providerErrors.join("; "),
          },
        });
      }

      // Auto-enable worktree grouping if worktrees are detected
      // Only auto-enable if user has never explicitly set the preference
      const { userMetadata, updateUserSettings } = get();
      const worktreeGrouping = userMetadata?.settings?.worktreeGrouping ?? false;
      const userHasSet = userMetadata?.settings?.worktreeGroupingUserSet ?? false;
      if (!get().isServerReadOnly && !worktreeGrouping && !userHasSet && projects.length > 0) {
        const { groups } = detectWorktreeGroupsHybrid(projects);
        if (groups.length > 0) {
          if (requestId !== getRequestId("scanProjects")) {
            return;
          }
          // Worktrees detected - auto-enable grouping
          await updateUserSettings({ worktreeGrouping: true });
          if (requestId !== getRequestId("scanProjects")) {
            return;
          }
          if (import.meta.env.DEV) {
            console.log(
              `[Worktree] Auto-enabled grouping: ${groups.length} groups detected`
            );
          }
        }
      }
    } catch (error) {
      if (requestId !== getRequestId("scanProjects")) {
        return;
      }
      console.error("Failed to scan projects:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      if (requestId === getRequestId("scanProjects")) {
        set({ isLoadingProjects: false });
      }
    }
  },

  refreshAllConversations: async () => {
    if (get().isRefreshingAllConversations) {
      return;
    }

    const previouslySelectedProject = get().selectedProject;
    const previouslySelectedSession = get().selectedSession;

    set({ isRefreshingAllConversations: true, error: null });

    try {
      await get().scanProjects();

      const stateAfterScan = get();
      if (!previouslySelectedProject) {
        if (stateAfterScan.analytics.currentView === "analytics") {
          await stateAfterScan.loadGlobalStats();
        }
        return;
      }

      const refreshedProject = stateAfterScan.projects.find((project) =>
        isSameProject(project, previouslySelectedProject)
      );

      if (!refreshedProject) {
        get().clearProjectSelection();
        return;
      }

      await get().selectProject(refreshedProject);

      let refreshedSession: ClaudeSession | null = null;
      if (previouslySelectedSession) {
        refreshedSession = get().sessions.find((session) =>
          isSameSession(session, previouslySelectedSession)
        ) ?? null;

        if (refreshedSession) {
          await get().selectSession(refreshedSession);
        } else {
          set({
            selectedSession: null,
            messages: [],
            pagination: { ...INITIAL_PAGINATION },
            isLoadingMessages: false,
            subagentSessions: [],
            parentSessionStack: [],
          });
          get().clearSessionSearch();
          get().clearTokenStats();
          get().clearTargetMessage();
        }
      }

      const refreshedState = get();
      if (refreshedState.analytics.currentView === "tokenStats") {
        await refreshedState.loadProjectTokenStats(refreshedProject.path);
        if (refreshedSession) {
          await refreshedState.loadSessionTokenStats(refreshedSession.file_path);
        }
      } else if (refreshedState.analytics.currentView === "analytics") {
        const projectSummary = await refreshedState.loadProjectStatsSummary(
          refreshedProject.path
        );
        refreshedState.setAnalyticsProjectSummary(projectSummary);
        if (refreshedSession) {
          const sessionComparison = await refreshedState.loadSessionComparison(
            refreshedSession.actual_session_id,
            refreshedProject.path
          );
          refreshedState.setAnalyticsSessionComparison(sessionComparison);
        } else {
          refreshedState.setAnalyticsSessionComparison(null);
        }
      } else if (refreshedState.analytics.currentView === "recentEdits") {
        const recentEdits = await refreshedState.loadRecentEdits(
          refreshedProject.path
        );
        // Same ownership rule as the navigation hook: if the selection moved on
        // while this was in flight, writing would show one project's edits
        // under another's identity.
        if (get().selectedProject?.path === refreshedProject.path) {
          // The whole page, so the cursor is replaced along with the rows.
          // Passing only the rows is what left the cursor at 60 while the list
          // went back to page 1 (#517).
          refreshedState.setAnalyticsRecentEdits(
            recentEdits,
            refreshedProject.path
          );
        }
      } else if (refreshedState.analytics.currentView === "board") {
        refreshedState.clearBoard();
        await refreshedState.loadBoardSessions(get().sessions);
      } else if (refreshedState.analytics.currentView === "archive") {
        await refreshedState.loadArchives();
      }
    } catch (error) {
      console.error("Failed to refresh all conversations:", error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to refresh conversations: ${message}`);
      get().setError({
        type: AppErrorType.UNKNOWN,
        message,
      });
    } finally {
      set({ isRefreshingAllConversations: false });
    }
  },

  selectProject: async (project: ClaudeProject) => {
    // Selection is scoped to a single project's session list; switching
    // projects abandons any in-progress multi-selection and any session that
    // belonged to the project being left.
    get().exitSessionSelectionMode();
    set({ selectedSession: null });
    await get().reloadProjectSessions(project);
  },

  /**
   * Load a project's first page of sessions without touching the selection.
   *
   * Split out of `selectProject` for the file watcher. `selectProject` nulls
   * `selectedSession` because it is written for "the user picked a different
   * project", and the watcher was reusing it to refresh the *current* one — so
   * every write to an open session's JSONL dropped the app to the empty state
   * (#508). The session refresh that would have restored it is on a 1500ms
   * quiet period while this reload fires at 250ms, so the selection was always
   * already gone.
   *
   * A matching session in the reloaded page replaces the held one, so its
   * message count and timestamps refresh in the list. A session that is *not*
   * in the page is left selected rather than cleared: this is only the first
   * page, so absence means "not on page 1", not "deleted".
   */
  reloadProjectSessions: async (project: ClaudeProject) => {
    const requestId = nextRequestId("selectProject");
    set({
      selectedProject: project,
      sessions: [],
      sessionsTotal: project.session_count,
      sessionsOffset: 0,
      hasMoreSessions: false,
      isLoadingSessions: true,
      isLoadingMoreSessions: false,
    });
    try {
      const provider = project.provider ?? "claude";
      const page = await api<SessionPage>("load_provider_sessions_page", {
        provider,
        projectPath: project.path,
        excludeSidechain: get().excludeSidechain,
        offset: 0,
        limit: SESSION_PAGE_LIMIT,
      });

      if (requestId !== getRequestId("selectProject")) {
        return;
      }

      set({
        sessions: page.sessions,
        sessionsTotal: page.total,
        sessionsOffset: page.nextOffset,
        hasMoreSessions: page.hasMore,
      });

      const held = get().selectedSession;
      if (held) {
        const refreshed = page.sessions.find(
          (session) => session.file_path === held.file_path
        );
        if (refreshed) {
          set({ selectedSession: refreshed });
        }
      }

      // Update project's session_count to match actual loaded sessions
      // (scan_projects counts files, but load_sessions filters invalid ones)
      if (page.total !== project.session_count) {
        const projects = get().projects.map((p) =>
          p.path === project.path
            ? { ...p, session_count: page.total }
            : p
        );
        set({ projects });
      }
    } catch (error) {
      if (requestId !== getRequestId("selectProject")) {
        return;
      }
      console.error("Failed to load project sessions:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      if (requestId === getRequestId("selectProject")) {
        set({ isLoadingSessions: false });
      }
    }
  },

  loadMoreSessions: async () => {
    const {
      selectedProject,
      sessionsOffset,
      hasMoreSessions,
      isLoadingSessions,
      isLoadingMoreSessions,
    } = get();

    if (
      selectedProject == null ||
      !hasMoreSessions ||
      isLoadingSessions ||
      isLoadingMoreSessions
    ) {
      return;
    }

    const requestId = getRequestId("selectProject");
    set({ isLoadingMoreSessions: true });

    try {
      const page = await api<SessionPage>("load_provider_sessions_page", {
        provider: selectedProject.provider ?? "claude",
        projectPath: selectedProject.path,
        excludeSidechain: get().excludeSidechain,
        offset: sessionsOffset,
        limit: SESSION_PAGE_LIMIT,
      });

      if (requestId !== getRequestId("selectProject")) {
        return;
      }

      set({
        sessions: dedupeSessionsById([...get().sessions, ...page.sessions]),
        sessionsTotal: page.total,
        sessionsOffset: page.nextOffset,
        hasMoreSessions: page.hasMore,
      });
    } catch (error) {
      if (requestId !== getRequestId("selectProject")) {
        return;
      }
      console.error("Failed to load more project sessions:", error);
      set({ error: { type: AppErrorType.UNKNOWN, message: String(error) } });
    } finally {
      if (requestId === getRequestId("selectProject")) {
        set({ isLoadingMoreSessions: false });
      }
    }
  },

  clearProjectSelection: (options) => {
    nextRequestId("selectProject");

    set({
      selectedProject: null,
      selectedSession: null,
      sessions: [],
      sessionsTotal: 0,
      sessionsOffset: 0,
      hasMoreSessions: false,
      messages: [],
      pagination: { ...INITIAL_PAGINATION },
      isLoadingMessages: false,
      isLoadingSessions: false,
      isLoadingMoreSessions: false,
      subagentSessions: [],
      parentSessionStack: [],
    });

    get().clearSessionSearch();
    get().clearTokenStats();
    get().resetAnalytics();
    get().clearBoard();
    get().setDateFilter({ start: null, end: null });
    get().clearTargetMessage();
    get().exitSessionSelectionMode();
    writeWebUIDeepLink(
      { sessionId: null, messageId: null },
      options?.history,
    );
  },

  setClaudePath: async (path: string) => {
    set({ claudePath: path });

    try {
      const store = await storageAdapter.load("settings.json", {
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
    set({
      sessions,
      sessionsTotal: sessions.length,
      sessionsOffset: sessions.length,
      hasMoreSessions: false,
    });
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
