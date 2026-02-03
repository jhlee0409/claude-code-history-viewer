// src/components/ProjectTree/types.ts
import type { ClaudeProject, ClaudeSession } from "../../types";
import type { GroupingMode } from "../../types/metadata.types";
import type { WorktreeGroup, DirectoryGroup } from "../../utils/worktreeUtils";

export interface ContextMenuState {
  project: ClaudeProject;
  position: { x: number; y: number };
}

export interface ProjectTreeProps {
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  onProjectSelect: (project: ClaudeProject) => void;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  onGlobalStatsClick: () => void;
  isLoading: boolean;
  isViewingGlobalStats: boolean;
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
}

export type GroupingStrategy = "none" | "directory" | "worktree";

export interface ProjectItemProps {
  project: ClaudeProject;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  variant?: "default" | "main" | "worktree";
}

export interface SessionListProps {
  sessions: ClaudeSession[];
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  formatTimeAgo: (date: string) => string;
  variant?: "default" | "main" | "worktree";
}

export interface GroupHeaderProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  variant: "directory" | "worktree";
}
