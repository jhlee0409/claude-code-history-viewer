// src/components/ProjectTree/types.ts
import type { ClaudeProject, ClaudeSession } from "../../types";
import type { GroupingMode } from "../../types/metadata.types";
import type { WorktreeGroup, DirectoryGroup, TimeGroup } from "../../utils/worktreeUtils";
import type { Boundary } from "../../utils/contextMenu";

export interface ContextMenuState {
  project: ClaudeProject;
  position: { x: number; y: number; boundary?: Boundary | null };
  /** Other providers' projects for the same folder (merged row). */
  providerSiblings?: ClaudeProject[];
}

/**
 * Open a session row. `owner` is the project the row is listed under, so the
 * session opens there and not in another project of the same name (Codex
 * names projects after the last directory segment).
 */
export type SessionSelectHandler = (session: ClaudeSession, owner?: ClaudeProject) => void;

export interface ProjectTreeProps {
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  sessionsTotal?: number;
  hasMoreSessions?: boolean;
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  onProjectSelect: (project: ClaudeProject) => void;
  onSessionSelect: SessionSelectHandler;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  onGlobalStatsClick: () => void;
  isLoading: boolean;
  isLoadingMoreSessions?: boolean;
  /** The library row the open screen is (library highlight, plan C3). */
  libraryItem?: import("@/navigation/place").LibraryItem | null;
  /**
   * An app-level screen is open, so the selected project/session are kept
   * context rather than what the main area shows (plan C3 tree projection).
   * Exposed as `data-selection="retained"` on the tree; the open project's
   * row is drawn dimmed.
   */
  isSelectionRetained?: boolean;
  /** List the expanded project's sessions under its row (default on). */
  inlineSessions?: boolean;
  width?: number;
  isResizing?: boolean;
  onResizeStart?: (e: React.MouseEvent<HTMLElement>) => void;
  // Grouping props
  groupingMode?: GroupingMode;
  worktreeGroups?: WorktreeGroup[];
  directoryGroups?: DirectoryGroup[];
  timeGroups?: TimeGroup[];
  ungroupedProjects?: ClaudeProject[];
  onGroupingModeChange?: (mode: GroupingMode) => void;
  // Project visibility props
  onHideProject?: (projectPath: string) => void;
  onUnhideProject?: (projectPath: string) => void;
  isProjectHidden?: (projectPath: string) => boolean;
  // Collapse props
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  asideId?: string;
  // Mobile drawer close callback
  onClose?: () => void;
  /** Library rows for the app-level screens (plan T7, §6). */
  onOpenArchive?: () => void;
  isArchiveDisabled?: boolean;
  onOpenSettingsManager?: () => void;
  /** The footer's help button (feedback). */
  onOpenHelp?: () => void;
}

export type GroupingStrategy = "none" | "directory" | "worktree" | "time";

export interface ProjectItemProps {
  project: ClaudeProject;
  isExpanded: boolean;
  /** The open project (the place's project context). */
  isSelected: boolean;
  /**
   * The open project is kept context while an app-level screen shows (plan
   * C3): highlighted, but dimmed.
   */
  isRetained?: boolean;
  ariaLevel?: number;
  onToggle: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  variant?: "default" | "main" | "worktree";
  showProviderBadge?: boolean;
  /**
   * Same working directory recorded by other providers. Rendered as chips
   * next to this row's own provider so one folder is one row.
   */
  providerSiblings?: ClaudeProject[];
  /** False when the row has nothing to expand (no sessions listed under it). */
  hasInlineChildren?: boolean;
  /** Leave room at the right end for a control drawn over the row ("Select"). */
  reserveTrailingSpace?: boolean;
}

export interface SessionListProps {
  sessions: ClaudeSession[];
  sessionsTotal?: number;
  hasMoreSessions?: boolean;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingMoreSessions?: boolean;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  formatTimeAgo: (date: string) => string;
  /** `pane`: standalone column (no tree indentation, virtual list fills `listHeight`). */
  variant?: "default" | "main" | "worktree" | "pane";
  /** Available height for the virtual list when `variant="pane"`. */
  listHeight?: number;
  /** `compact`: one-line tree rows (the sidebar, plan T7). */
  density?: "default" | "compact";
}

export interface GroupHeaderProps {
  groupKey: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  isExpanded: boolean;
  ariaLevel?: number;
  onToggle: () => void;
  variant: "directory" | "worktree" | "time" | "unavailable" | "temporary";
}
