// src/components/ProjectTree/types.ts
import type { ClaudeProject, ClaudeSession } from "../../types";
import type { GroupingMode } from "../../types/metadata.types";
import type { WorktreeGroup, DirectoryGroup } from "../../utils/worktreeUtils";
import type { Boundary } from "../../utils/contextMenu";

export interface ContextMenuState {
  project: ClaudeProject;
  position: { x: number; y: number; boundary?: Boundary | null };
}

export interface ProjectTreeProps {
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  sessionsTotal?: number;
  hasMoreSessions?: boolean;
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  onProjectSelect: (project: ClaudeProject) => void;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  onGlobalStatsClick: () => void;
  isLoading: boolean;
  isLoadingMoreSessions?: boolean;
  isViewingGlobalStats: boolean;
  /**
   * Render the selected project's sessions inline under its row. Off when the
   * layout shows them in a dedicated SessionsPane column.
   */
  inlineSessions?: boolean;
  width?: number;
  isResizing?: boolean;
  onResizeStart?: (e: React.MouseEvent<HTMLElement>) => void;
  // Grouping props
  groupingMode?: GroupingMode;
  worktreeGroups?: WorktreeGroup[];
  directoryGroups?: DirectoryGroup[];
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
}

export type GroupingStrategy = "none" | "directory" | "worktree";

export interface ProjectItemProps {
  project: ClaudeProject;
  isExpanded: boolean;
  isSelected: boolean;
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
  onSelectSibling?: (project: ClaudeProject) => void;
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
}

export interface GroupHeaderProps {
  groupKey: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  isExpanded: boolean;
  ariaLevel?: number;
  onToggle: () => void;
  variant: "directory" | "worktree" | "unavailable" | "temporary";
}
