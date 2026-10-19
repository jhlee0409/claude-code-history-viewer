// src/components/ProjectTree/index.tsx
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleQuestionMark,
  Folder,
  PanelLeftClose,
  PanelLeft,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { Icon } from "@/components/icon/Icon";
import { useTranslation } from "react-i18next";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatTimeAgo as formatTimeAgoUtil } from "../../utils/time";
import { isProjectTemporary } from "../../utils/pathUtils";
import { ProjectContextMenu } from "../ProjectContextMenu";
import { useProjectTreeState } from "./hooks/useProjectTreeState";
import { GroupedProjectList } from "./components/GroupedProjectList";
import { LibrarySection } from "./components/LibrarySection";
import { ProjectListMenu, type ProjectSort } from "./components/ProjectListMenu";
import type { ProjectTreeProps, SessionSelectHandler } from "./types";
import type { ProviderId, ClaudeProject } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { useProviderDiscovery } from "@/hooks/useProviderDiscovery";
import { placeNameKey } from "@/navigation/placeNames";
import {
  buildTreeItemAnnouncement,
  findTypeaheadMatchIndex,
  getNextTreeItemIndex,
  getTreeNavigationKey,
} from "./treeKeyboard";
import {
  DEFAULT_PROVIDER_ID,
  getProviderId,
  getProviderLabel,
  normalizeProviderIds,
  PROVIDER_IDS,
} from "../../utils/providers";

type ProviderTabId = "all" | ProviderId;

const PROJECT_SORT_STORAGE_KEY = "projectTree.sort";

const loadProjectSort = (): ProjectSort => {
  try {
    return localStorage.getItem(PROJECT_SORT_STORAGE_KEY) === "name" ? "name" : "recent";
  } catch {
    return "recent";
  }
};

/** Most recent activity first (plan T7), or by name. */
const sortProjects = (list: ClaudeProject[], sort: ProjectSort): ClaudeProject[] =>
  [...list].sort((a, b) =>
    sort === "name"
      ? (a.name ?? "").localeCompare(b.name ?? "")
      : new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime()
  );

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projects,
  sessions,
  sessionsTotal = sessions.length,
  hasMoreSessions = false,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onSessionHover,
  onLoadMoreSessions = () => {},
  onGlobalStatsClick,
  isLoading,
  isLoadingMoreSessions = false,
  libraryItem = null,
  isSelectionRetained = false,
  inlineSessions = true,
  width,
  isResizing,
  onResizeStart,
  groupingMode = "none",
  worktreeGroups = [],
  directoryGroups = [],
  timeGroups = [],
  ungroupedProjects,
  onGroupingModeChange,
  onHideProject,
  onUnhideProject,
  isProjectHidden,
  isCollapsed = false,
  onToggleCollapse,
  asideId = "project-explorer",
  onClose,
  onOpenArchive,
  isArchiveDisabled = false,
  onOpenSettingsManager,
  onOpenHelp,
}) => {
  const { t } = useTranslation();
  const keyboardHelpId = `${asideId}-keyboard-help`;
  const projectsHeadingId = `${asideId}-projects-heading`;
  const isGlobalStatsActive = libraryItem === "globalStats";
  const activeProviders = useAppStore((state) => state.activeProviders);
  const detectedProviders = useAppStore((state) => state.providers);
  const isDetectingProviders = useAppStore((state) => state.isDetectingProviders);
  const isLoadingProjects = useAppStore((state) => state.isLoadingProjects);
  const {
    discover: handleDiscoverProviders,
    hasSearched: hasSearchedOtherProviders,
  } = useProviderDiscovery();
  const setActiveProviders = useAppStore((state) => state.setActiveProviders);
  const loadGlobalStats = useAppStore((state) => state.loadGlobalStats);
  const navigate = useAppStore((state) => state.navigate);

  const {
    expandedProjects,
    setExpandedProjects,
    isProjectExpanded,
    ensureProjectExpanded,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  } = useProjectTreeState(groupingMode);

  const [searchTerm, setSearchTerm] = useState("");
  const [projectSort, setProjectSort] = useState<ProjectSort>(loadProjectSort);
  const searchInputId = React.useId();

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_SORT_STORAGE_KEY, projectSort);
    } catch {
      // localStorage may be unavailable; the default order still works.
    }
  }, [projectSort]);

  // Wrap session select to also close mobile drawer
  const handleSessionSelect = useCallback<SessionSelectHandler>(
    (session, owner) => {
      onSessionSelect(session, owner);
      onClose?.();
    },
    [onSessionSelect, onClose]
  );

  const providerCounts = useMemo(() => {
    const counts: Record<ProviderTabId, number> = {
      all: projects.length,
      aider: 0,
      amazonq: 0,
      antigravity: 0,
      claude: 0,
      cline: 0,
      codebuddy: 0,
      codex: 0,
      continue: 0,
      "copilot": 0,
      crush: 0,
      cursor: 0,
      "cursor-agent": 0,
      forgecode: 0,
      gemini: 0,
      goose: 0,
      grok: 0,
      kilo: 0,
      kimi: 0,
      kiro: 0,
      llm: 0,
      opencode: 0,
      openhands: 0,
      openinterpreter: 0,
      ompi: 0,
      pi: 0,
      pearai: 0,
      qwen: 0,
      trae: 0,
      vibe: 0,
      zed: 0,
      zcode: 0,
    };

    for (const project of projects) {
      counts[getProviderId(project.provider)] += 1;
    }

    return counts;
  }, [projects]);

  const selectableProviderIds = useMemo<ProviderId[]>(() => {
    const detected = detectedProviders
      .filter((provider) => provider.is_available)
      .map((provider) => provider.id as ProviderId);
    const discoveredFromProjects = PROVIDER_IDS.filter((id) => providerCounts[id] > 0);
    const ordered = PROVIDER_IDS.filter((id) =>
      detected.includes(id) || discoveredFromProjects.includes(id)
    );
    return ordered.length > 0 ? ordered : [DEFAULT_PROVIDER_ID];
  }, [detectedProviders, providerCounts]);

  const selectedProviderFilters = useMemo<ProviderId[]>(
    () => PROVIDER_IDS.filter((id) => activeProviders.includes(id) && selectableProviderIds.includes(id)),
    [activeProviders, selectableProviderIds]
  );

  const isAllProvidersSelected = useMemo(
    () =>
      // While provider detection is in progress, treat as "all selected"
      // to avoid a brief flash of incorrect filter state.
      isDetectingProviders ||
      (selectableProviderIds.length > 0 &&
        selectableProviderIds.every((provider) => selectedProviderFilters.includes(provider))),
    [isDetectingProviders, selectableProviderIds, selectedProviderFilters]
  );

  const showProviderBadge = isAllProvidersSelected
    ? selectableProviderIds.length > 1
    : selectedProviderFilters.length !== 1;

  const matchesProviderFilter = useCallback(
    (project: (typeof projects)[number]) =>
      isAllProvidersSelected || selectedProviderFilters.includes(getProviderId(project.provider)),
    [isAllProvidersSelected, selectedProviderFilters]
  );

  const applyProviderSelection = useCallback(
    async (nextProviders: ProviderId[]) => {
      const normalized = normalizeProviderIds(nextProviders);
      if (normalized.length === 0) {
        return;
      }

      const current = normalizeProviderIds(activeProviders);
      const isUnchanged =
        current.length === normalized.length &&
        current.every((id, index) => id === normalized[index]);
      if (isUnchanged) {
        return;
      }

      const previousSelectedProjectPath = selectedProject?.path;
      const shouldClearSelection =
        selectedProject !== null &&
        !normalized.includes(getProviderId(selectedProject.provider));

      try {
        setActiveProviders(normalized);

        if (isGlobalStatsActive) {
          await loadGlobalStats();
        }

        // Clear selection only after provider switch finishes successfully.
        // This prevents rollback paths from leaving cleared selection behind.
        if (shouldClearSelection) {
          const latestSelectedProject = useAppStore.getState().selectedProject;
          if (latestSelectedProject?.path === previousSelectedProjectPath) {
            void navigate({ project: null });
          }
        }
      } catch (error) {
        console.error("Failed to apply provider selection:", error);
        setActiveProviders(current);
        toast.error(t("common.provider.filterApplyError", "Failed to apply provider filter"));
      }
    },
    [
      activeProviders,
      navigate,
      isGlobalStatsActive,
      loadGlobalStats,
      selectedProject,
      setActiveProviders,
      t,
    ]
  );

  // Checkbox semantics: unchecking removes a provider (the last one resets
  // to all), checking adds it.
  const toggleProviderFilter = useCallback(async (provider: ProviderId) => {
    const current = isAllProvidersSelected ? selectableProviderIds : selectedProviderFilters;
    const next = current.includes(provider)
      ? current.filter((id) => id !== provider)
      : PROVIDER_IDS.filter((id) => selectableProviderIds.includes(id) && (current.includes(id) || id === provider));
    await applyProviderSelection(next.length > 0 ? next : selectableProviderIds);
  }, [applyProviderSelection, isAllProvidersSelected, selectableProviderIds, selectedProviderFilters]);

  // Defer the filtering work: the input echoes each keystroke immediately
  // while re-filtering hundreds/thousands of projects runs as an
  // interruptible low-priority render (no per-keystroke jank).
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearchTerm = useMemo(
    () => deferredSearchTerm.trim().toLowerCase(),
    [deferredSearchTerm]
  );

  const matchesSearch = useCallback(
    (project: (typeof projects)[number]) => {
      if (!normalizedSearchTerm) return true;
      const name = (project.name ?? "").toLowerCase();
      const path = (project.actual_path ?? project.path ?? "").toLowerCase();
      return name.includes(normalizedSearchTerm) || path.includes(normalizedSearchTerm);
    },
    [normalizedSearchTerm]
  );

  const filteredProjects = useMemo(
    () => projects.filter((p) => matchesProviderFilter(p) && matchesSearch(p)),
    [projects, matchesProviderFilter, matchesSearch]
  );

  const filteredDirectoryGroups = useMemo(() => {
    const filterFn = (p: (typeof projects)[number]) =>
      matchesProviderFilter(p) && matchesSearch(p);

    if (isAllProvidersSelected && !normalizedSearchTerm) {
      return directoryGroups;
    }

    return directoryGroups
      .map((group) => ({
        ...group,
        projects: group.projects.filter(filterFn),
      }))
      .filter((group) => group.projects.length > 0);
  }, [directoryGroups, isAllProvidersSelected, matchesProviderFilter, matchesSearch, normalizedSearchTerm]);

  const filteredTimeGroups = useMemo(() => {
    const filterFn = (p: (typeof projects)[number]) =>
      matchesProviderFilter(p) && matchesSearch(p);

    if (isAllProvidersSelected && !normalizedSearchTerm) {
      return timeGroups;
    }

    return timeGroups
      .map((group) => ({
        ...group,
        projects: group.projects.filter(filterFn),
      }))
      .filter((group) => group.projects.length > 0);
  }, [timeGroups, isAllProvidersSelected, matchesProviderFilter, matchesSearch, normalizedSearchTerm]);

  const { filteredWorktreeGroups, filteredUngroupedProjects } = useMemo(() => {
    const baseUngrouped = ungroupedProjects ?? projects;
    const filterFn = (p: (typeof projects)[number]) =>
      matchesProviderFilter(p) && matchesSearch(p);

    if (isAllProvidersSelected && !normalizedSearchTerm) {
      return {
        filteredWorktreeGroups: worktreeGroups,
        filteredUngroupedProjects: baseUngrouped,
      };
    }

    const nextGroups: typeof worktreeGroups = [];
    const movedChildren: (typeof projects)[number][] = [];

    for (const group of worktreeGroups) {
      const includeParent = filterFn(group.parent);
      const matchingChildren = group.children.filter(filterFn);

      if (includeParent) {
        nextGroups.push({
          ...group,
          children: matchingChildren,
        });
      } else if (matchingChildren.length > 0) {
        movedChildren.push(...matchingChildren);
      }
    }

    const baseFiltered = baseUngrouped.filter(filterFn);
    const seenPaths = new Set(baseFiltered.map((project) => project.path));
    const movedChildrenToAdd = movedChildren.filter((child) => {
      if (seenPaths.has(child.path)) {
        return false;
      }
      seenPaths.add(child.path);
      return true;
    });
    const nextUngrouped = [...baseFiltered, ...movedChildrenToAdd];

    return {
      filteredWorktreeGroups: nextGroups,
      filteredUngroupedProjects: nextUngrouped,
    };
  }, [worktreeGroups, ungroupedProjects, projects, isAllProvidersSelected, matchesProviderFilter, matchesSearch, normalizedSearchTerm]);

  const providerOptions = useMemo(
    () =>
      selectableProviderIds.map((id) => ({
        id,
        label: getProviderLabel((key, fallback) => t(key, fallback), id),
        count: providerCounts[id],
        checked: isAllProvidersSelected || selectedProviderFilters.includes(id),
      })),
    [isAllProvidersSelected, providerCounts, selectableProviderIds, selectedProviderFilters, t]
  );

  const sortedProjects = useMemo(() => sortProjects(filteredProjects, projectSort), [filteredProjects, projectSort]);
  const sortedUngroupedProjects = useMemo(
    () => sortProjects(filteredUngroupedProjects, projectSort),
    [filteredUngroupedProjects, projectSort]
  );

  // Re-created per render so the label follows the active language.
  const formatTimeAgo = (dateStr: string) => formatTimeAgoUtil(dateStr);

  // Open a project (the context menu's provider switch; the rows decide
  // between opening and expanding themselves, see GroupedProjectList). The
  // opened project is the one expanded row.
  const handleProjectClick = useCallback(
    (project: typeof selectedProject) => {
      if (!project) return;
      setExpandedProjects((prev) => {
        const next = new Set<string>();
        for (const key of prev) {
          if (key.startsWith("dir:") || key.startsWith("group:") || key.startsWith("time:")) {
            next.add(key);
          }
        }
        next.add(project.path);
        return next;
      });
      onProjectSelect(project);
    },
    [onProjectSelect, setExpandedProjects]
  );

  const selectedProjectGroupKey = useMemo(() => {
    if (!selectedProject) return undefined;

    if (selectedProject.path_status === "unavailable") {
      return "group:unavailable-projects";
    }
    // Temporary-location projects render under their own bucket in every
    // grouping mode, so that bucket (not the directory group) must open.
    if (isProjectTemporary(selectedProject)) {
      return "group:temporary-projects";
    }

    if (groupingMode === "directory") {
      const group = directoryGroups.find((candidate) =>
        candidate.projects.some((project) => project.path === selectedProject.path)
      );
      return group ? `dir:${group.path}` : undefined;
    }

    if (groupingMode === "worktree") {
      const group = worktreeGroups.find(
        (candidate) =>
          candidate.parent.path === selectedProject.path ||
          candidate.children.some((project) => project.path === selectedProject.path)
      );
      return group ? `group:${group.parent.path}` : undefined;
    }

    if (groupingMode === "time") {
      const group = timeGroups.find((candidate) =>
        candidate.projects.some((project) => project.path === selectedProject.path)
      );
      return group ? `time:${group.bucket}` : undefined;
    }

    return undefined;
  }, [directoryGroups, groupingMode, selectedProject, timeGroups, worktreeGroups]);

  // Global search and deep-link flows select projects through the store rather
  // than through handleProjectClick, so the tree's local expansion state would
  // otherwise stay collapsed (#486). Re-apply the selected project/session to
  // the tree and include its containing group when grouped.
  useEffect(() => {
    if (!selectedProject?.path) return;
    ensureProjectExpanded(selectedProject.path, selectedProjectGroupKey);
  }, [
    ensureProjectExpanded,
    selectedProject?.path,
    selectedProjectGroupKey,
    selectedSession?.file_path,
  ]);

  const handleGlobalStatsClick = onGlobalStatsClick;

  const sidebarStyle = isCollapsed ? { width: "48px" } : width ? { width: `${width}px` } : undefined;
  const treeRef = useRef<HTMLDivElement>(null);
  const typeaheadQueryRef = useRef("");
  const typeaheadTimeoutRef = useRef<number | null>(null);
  const [treeAnnouncement, setTreeAnnouncement] = useState("");

  const announceTree = useCallback((message: string) => {
    if (!message) return;
    setTreeAnnouncement((previous) => (previous === message ? `${message} ` : message));
  }, []);

  const describeTreeItem = useCallback((item: HTMLElement) => {
    const rawLabel = item.getAttribute("aria-label") || item.textContent || "";
    return buildTreeItemAnnouncement(
      rawLabel,
      {
        ariaExpanded: item.getAttribute("aria-expanded") as "true" | "false" | null,
        ariaSelected: item.getAttribute("aria-selected") as "true" | "false" | null,
      },
      {
        expanded: t("project.a11y.expandedState", "expanded"),
        collapsed: t("project.a11y.collapsedState", "collapsed"),
        selected: t("project.a11y.selectedState", "selected"),
      },
      t("project.explorer")
    );
  }, [t]);

  const syncRovingTabIndex = useCallback((preferredItem?: HTMLElement) => {
    const tree = treeRef.current;
    if (!tree) return;

    const treeItems = Array.from(
      tree.querySelectorAll<HTMLElement>('[role="treeitem"]')
    );
    if (treeItems.length === 0) {
      return;
    }

    const activeElement = document.activeElement;
    const focusedItem = activeElement instanceof HTMLElement
      ? activeElement.closest<HTMLElement>('[role="treeitem"]')
      : null;

    const selectedItem = treeItems.find((item) => item.getAttribute("aria-selected") === "true");
    const fallbackItem = selectedItem ?? treeItems[0];
    const nextTabStop = preferredItem ?? focusedItem ?? fallbackItem;

    for (const item of treeItems) {
      item.tabIndex = item === nextTabStop ? 0 : -1;
    }
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => syncRovingTabIndex());
    return () => cancelAnimationFrame(frameId);
  }, [
    syncRovingTabIndex,
    filteredProjects.length,
    filteredDirectoryGroups.length,
    filteredWorktreeGroups.length,
    filteredUngroupedProjects.length,
    groupingMode,
    selectedProject?.path,
    isGlobalStatsActive,
  ]);

  useEffect(() => {
    if (!selectedProject?.path || !treeRef.current) return;

    const frameId = requestAnimationFrame(() => {
      const projectItem = Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>(
          '[data-tree-node="project"]'
        ) ?? []
      ).find((item) => item.dataset.projectPath === selectedProject.path);

      projectItem?.scrollIntoView?.({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frameId);
  }, [expandedProjects, selectedProject?.path, selectedSession?.file_path]);

  const handleTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const treeItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')
    );
    if (treeItems.length === 0) {
      return;
    }

    const currentItem = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const currentIndex = currentItem ? treeItems.indexOf(currentItem) : -1;
    if (currentIndex < 0) {
      return;
    }

    if (event.key === "*") {
      event.preventDefault();
      const currentLevel = Number(currentItem?.getAttribute("aria-level") ?? "1");
      const siblingGroups = treeItems.filter(
        (item) =>
          item !== currentItem &&
          Number(item.getAttribute("aria-level") ?? "1") === currentLevel &&
          item.getAttribute("data-tree-expandable") === "true" &&
          item.getAttribute("aria-expanded") === "false"
      );

      const siblingGroupKeys = siblingGroups
        .map((item) => item.getAttribute("data-tree-key"))
        .filter((key): key is string => Boolean(key));

      if (siblingGroupKeys.length > 0) {
        setExpandedProjects((prev) => {
          const next = new Set(prev);
          for (const groupKey of siblingGroupKeys) {
            next.add(groupKey);
          }
          return next;
        });
      }
      announceTree(
        t(
          "project.expandedSiblingGroups",
          "Expanded {{count}} sibling groups",
          { count: siblingGroups.length }
        )
      );
      return;
    }

    if (
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const nextQuery = `${typeaheadQueryRef.current}${event.key.toLowerCase()}`;
      typeaheadQueryRef.current = nextQuery;
      if (typeaheadTimeoutRef.current) {
        window.clearTimeout(typeaheadTimeoutRef.current);
      }
      typeaheadTimeoutRef.current = window.setTimeout(() => {
        typeaheadQueryRef.current = "";
        typeaheadTimeoutRef.current = null;
      }, 500);

      const labels = treeItems.map((item) => item.textContent ?? "");
      const matchIndex = findTypeaheadMatchIndex(labels, currentIndex, nextQuery);
      if (matchIndex >= 0) {
        event.preventDefault();
        const nextItem = treeItems[matchIndex];
        syncRovingTabIndex(nextItem);
        nextItem?.focus();
        if (nextItem) {
          announceTree(describeTreeItem(nextItem));
        }
      }
      return;
    }

    const navigationKey = getTreeNavigationKey(event);
    if (!navigationKey) {
      return;
    }

    const nextIndex = getNextTreeItemIndex(currentIndex, treeItems.length, navigationKey);
    if (nextIndex === currentIndex || nextIndex < 0) {
      return;
    }

    event.preventDefault();
    const nextItem = treeItems[nextIndex];
    if (!nextItem) return;
    syncRovingTabIndex(nextItem);
    nextItem.focus();
    announceTree(describeTreeItem(nextItem));
  }, [announceTree, describeTreeItem, setExpandedProjects, syncRovingTabIndex, t]);

  useEffect(() => () => {
    if (typeaheadTimeoutRef.current) {
      window.clearTimeout(typeaheadTimeoutRef.current);
    }
  }, []);

  // Announce once per selection change. `announceTree` alternates the text so
  // a repeat is re-read, so re-running this on an unrelated dependency change
  // (a new `t`) would set state on every render and never settle.
  const announcedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;

    const selectedItem = tree.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]');
    if (!selectedItem) return;

    const selectionKey = `${selectedProject?.path ?? ""}|${String(isGlobalStatsActive)}`;
    if (announcedSelectionRef.current === selectionKey) return;
    announcedSelectionRef.current = selectionKey;

    announceTree(
      t("project.currentSelection", "Selected: {{item}}", {
        item: describeTreeItem(selectedItem),
      })
    );
  }, [announceTree, describeTreeItem, isGlobalStatsActive, selectedProject?.path, t]);

  const libraryProps = {
    activeItem: libraryItem,
    onGlobalStatsClick: handleGlobalStatsClick,
    onOpenArchive,
    isArchiveDisabled,
    onOpenSettingsManager,
    onNavigate: onClose,
  };

  // Collapsed View: a rail with the library's screens.
  if (isCollapsed) {
    return (
      <aside
        id={asideId}
        aria-label={t("project.explorer")}
        tabIndex={-1}
        data-menu-boundary
        className={cn("flex-shrink-0 bg-sidebar border-r border-border/50 flex h-full", isResizing && "select-none")}
        style={sidebarStyle}
      >
        <div className="flex-1 flex flex-col items-center py-2 gap-1">
          {onToggleCollapse && (
            <RailButton
              icon={PanelLeft}
              label={t("project.expandSidebar", "Expand sidebar")}
              onClick={onToggleCollapse}
            />
          )}
          <div className="w-6 h-px bg-border my-1" />
          <RailButton
            icon={SCREEN_ICONS.globalStats}
            label={t(placeNameKey("globalStats"))}
            active={libraryItem === "globalStats"}
            onClick={handleGlobalStatsClick}
          />
          {onOpenArchive && (
            <RailButton
              icon={SCREEN_ICONS.archive}
              label={t(placeNameKey("archive"))}
              active={libraryItem === "archive"}
              disabled={isArchiveDisabled}
              onClick={onOpenArchive}
            />
          )}
          {onOpenSettingsManager && (
            <RailButton
              icon={SCREEN_ICONS.settings}
              label={t(placeNameKey("settingsManager"))}
              active={libraryItem === "settingsManager"}
              onClick={onOpenSettingsManager}
            />
          )}
          <div className="w-6 h-px bg-border my-1" />
          <div className="flex flex-col items-center gap-1" title={t("project.projects")}>
            <Folder className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-caption tabular-nums text-muted-foreground">{filteredProjects.length}</span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      id={asideId}
      aria-label={t("project.explorer")}
      tabIndex={-1}
      data-menu-boundary
      className={cn(
        "flex-shrink-0 bg-sidebar border-r border-border/50 flex h-full",
        !width && (!onToggleCollapse && onClose ? "w-full" : "w-64"),
        isResizing && "select-none"
      )}
      style={sidebarStyle}
    >
      <div className="flex-1 flex flex-col min-w-0">
        <OverlayScrollbarsComponent
          // min-h-0 lets this flex child shrink to its basis instead of growing
          // to full content height (default min-height:auto). Without it,
          // OverlayScrollbars measures a skewed content/viewport ratio and the
          // thumb never reaches the bottom on long project lists (issue #101).
          className="relative flex-1 min-h-0"
          options={{
            scrollbars: {
              theme: "os-theme-custom",
              autoHide: "leave",
              autoHideDelay: 400,
            },
            overflow: {
              x: "hidden",
            },
          }}
        >
          <LibrarySection {...libraryProps} />

          <section aria-labelledby={projectsHeadingId} className="px-2 pb-2">
            <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
              <h2 id={projectsHeadingId} className="text-caption font-medium text-muted-foreground">
                {t("project.projects")}
              </h2>
              <span className="text-caption tabular-nums text-muted-foreground">{filteredProjects.length}</span>
            </div>
            <div className="flex items-center gap-1 pb-1">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
                <label htmlFor={searchInputId} className="sr-only">
                  {t("project.filterPlaceholder")}
                </label>
                <input
                  id={searchInputId}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t("project.filterPlaceholder")}
                  className="w-full h-7 pl-7 pr-7 text-list bg-muted/40 border border-transparent rounded-md placeholder:text-muted-foreground focus:outline-none focus:border-accent/40 focus:bg-muted/60 transition-colors"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={t("common.clear", "Clear")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <ProjectListMenu
                sort={projectSort}
                onSortChange={setProjectSort}
                groupingMode={groupingMode}
                onGroupingModeChange={onGroupingModeChange}
                providers={providerOptions}
                isAllProvidersSelected={isAllProvidersSelected}
                onToggleProvider={(id) => void toggleProviderFilter(id)}
                onResetProviders={() => void applyProviderSelection(selectableProviderIds)}
                onDiscoverProviders={handleDiscoverProviders}
                isDiscovering={isDetectingProviders || isLoadingProjects}
              />
            </div>

            {filteredProjects.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted/30 flex items-center justify-center">
                  <Icon icon={Folder} size={24} className="text-muted-foreground/40" />
                </div>
                {/* No projects at all reads the same as the main area's empty
                    state; a filter with no match keeps "not found". */}
                <p className="text-body text-muted-foreground [&:lang(ko)]:break-keep">
                  {projects.length === 0
                    ? t(hasSearchedOtherProviders ? "session.noProjects.title" : "session.noProjects.claudeTitle")
                    : t("project.notFound")}
                </p>
              </div>
            ) : (
              <div
                ref={treeRef}
                role="tree"
                data-selection={isSelectionRetained ? "retained" : "active"}
                aria-labelledby={projectsHeadingId}
                aria-describedby={keyboardHelpId}
                onKeyDown={handleTreeKeyDown}
                onFocusCapture={(event) => {
                  const target = event.target as HTMLElement;
                  const treeItem = target.closest<HTMLElement>('[role="treeitem"]');
                  if (treeItem) {
                    syncRovingTabIndex(treeItem);
                    announceTree(describeTreeItem(treeItem));
                  }
                }}
              >
                <GroupedProjectList
                  groupingMode={groupingMode}
                  projects={sortedProjects}
                  directoryGroups={filteredDirectoryGroups}
                  timeGroups={filteredTimeGroups}
                  worktreeGroups={filteredWorktreeGroups}
                  ungroupedProjects={sortedUngroupedProjects}
                  showProviderBadge={showProviderBadge}
                  sessions={sessions}
                  sessionsTotal={sessionsTotal}
                  hasMoreSessions={hasMoreSessions}
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  isLoading={isLoading}
                  isLoadingMoreSessions={isLoadingMoreSessions}
                  expandedProjects={expandedProjects}
                  setExpandedProjects={setExpandedProjects}
                  isProjectExpanded={isProjectExpanded}
                  handleProjectClick={handleProjectClick}
                  handleContextMenu={handleContextMenu}
                  onSessionSelect={handleSessionSelect}
                  onSessionHover={onSessionHover}
                  onLoadMoreSessions={onLoadMoreSessions}
                  formatTimeAgo={formatTimeAgo}
                  inlineSessions={inlineSessions}
                  isSelectionRetained={isSelectionRetained}
                />
              </div>
            )}
          </section>
        </OverlayScrollbarsComponent>

        {/* Footer: help (feedback) and the sidebar's own toggle. */}
        <div className="h-8 shrink-0 flex items-center justify-between gap-1 px-2 border-t border-border/50">
          {onOpenHelp ? (
            <button
              type="button"
              onClick={() => {
                onOpenHelp();
                onClose?.();
              }}
              className="h-7 min-w-0 flex items-center gap-1.5 px-2 rounded-md text-list text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={t("common.helpMenu.feedback")}
              title={t("common.helpMenu.feedback")}
            >
              <CircleQuestionMark className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("common.helpMenu.title")}</span>
            </button>
          ) : (
            <span />
          )}
          {onToggleCollapse && (
            <RailButton
              icon={PanelLeftClose}
              label={t("project.collapseSidebar", "Collapse sidebar")}
              onClick={onToggleCollapse}
            />
          )}
          {!onToggleCollapse && onClose && (
            <RailButton icon={X} label={t("common.close", "Close")} onClick={onClose} />
          )}
        </div>

        <p id={keyboardHelpId} className="sr-only">
          {t(
            "project.a11y.keyboardHelp",
            "Keyboard: use arrow keys to move, Home and End to jump, type letters to search, and star to expand collapsed sibling groups."
          )}
        </p>

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {treeAnnouncement}
        </div>
      </div>

      {/* Resize Handle - Outside scroll area */}
      {onResizeStart && (
        <div
          className={cn(
            "w-1 -ml-1 cursor-col-resize flex-shrink-0 relative z-10",
            "hover:bg-accent/30 active:bg-accent/40 transition-colors",
            isResizing && "bg-accent/40"
          )}
          onMouseDown={onResizeStart}
        />
      )}

      {/* Context Menu */}
      {contextMenu && onHideProject && onUnhideProject && isProjectHidden && (
        <ProjectContextMenu
          project={contextMenu.project}
          position={contextMenu.position}
          onClose={closeContextMenu}
          onHide={onHideProject}
          onUnhide={onUnhideProject}
          isHidden={isProjectHidden(contextMenu.project.actual_path)}
          providerSiblings={contextMenu.providerSiblings}
          onSelectProject={handleProjectClick}
        />
      )}
    </aside>
  );
};

/** A 28px icon button with its label as tooltip and accessible name. */
const RailButton = ({
  icon: Glyph,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-current={active ? "page" : undefined}
    title={label}
    className={cn(
      "w-7 h-7 shrink-0 rounded-md flex items-center justify-center transition-colors",
      active ? "bg-accent/15 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      disabled && "opacity-50 cursor-not-allowed"
    )}
  >
    <Glyph className="w-4 h-4" />
  </button>
);
