/**
 * @deprecated This file is deprecated. Import from '@/types' or '@/types/core/project' instead.
 *
 * User metadata types for storing custom data
 *
 * This module contains data structures for user-specific metadata
 * that is stored separately from Claude Code's original data.
 * Location: ~/.claude-history-viewer/user-data.json
 *
 * @see src/types/core/project.ts for the canonical implementation
 */

import { matchGlobPattern } from "../utils/globUtils";

/** Current schema version for migration support */
export const METADATA_SCHEMA_VERSION = 1;

/** Metadata for individual sessions */
export interface SessionMetadata {
  /** Custom name for the session (overrides auto-generated summary) */
  customName?: string;
  /** Whether the session is starred/favorited */
  starred?: boolean;
  /** User-defined tags for organization */
  tags?: string[];
  /** User notes about the session */
  notes?: string;
  /** Whether the session has been renamed via Claude Code native rename (synced with CLI) */
  hasClaudeCodeName?: boolean;
}

/** Metadata for individual projects */
export interface ProjectMetadata {
  /** Whether the project is hidden from the sidebar */
  hidden?: boolean;
  /** Custom alias/display name for the project */
  alias?: string;
  /** Parent project path for worktree grouping */
  parentProject?: string;
}

/** Grouping mode for project tree display */
export type GroupingMode = "none" | "worktree" | "directory";

/** Global user settings */
export interface UserSettings {
  /** Glob patterns for projects to hide (e.g., "folders-dg-*") */
  hiddenPatterns?: string[];
  /** Whether to automatically group worktrees under their parent repos */
  worktreeGrouping?: boolean;
  /** Whether user has explicitly set worktree grouping (prevents auto-override) */
  worktreeGroupingUserSet?: boolean;
  /** Project tree grouping mode: none, worktree, or directory */
  groupingMode?: GroupingMode;
}

/** Root structure for all user metadata */
export interface UserMetadata {
  /** Schema version for migration support */
  version: number;
  /** Session-specific metadata, keyed by session ID */
  sessions: Record<string, SessionMetadata>;
  /** Project-specific metadata, keyed by project path */
  projects: Record<string, ProjectMetadata>;
  /** Global user settings */
  settings: UserSettings;
}

/** Default user metadata for initialization */
export const DEFAULT_USER_METADATA: UserMetadata = {
  version: METADATA_SCHEMA_VERSION,
  sessions: {},
  projects: {},
  settings: {},
};

/** Helper to check if session metadata is empty */
export const isSessionMetadataEmpty = (metadata: SessionMetadata): boolean => {
  return (
    !metadata.customName &&
    !metadata.starred &&
    (!metadata.tags || metadata.tags.length === 0) &&
    !metadata.notes &&
    !metadata.hasClaudeCodeName
  );
};

/** Helper to check if project metadata is empty */
export const isProjectMetadataEmpty = (metadata: ProjectMetadata): boolean => {
  return !metadata.hidden && !metadata.alias && !metadata.parentProject;
};

/** Helper to get session display name (custom name or fallback) */
export const getSessionDisplayName = (
  metadata: UserMetadata | null,
  sessionId: string,
  fallbackSummary?: string
): string | undefined => {
  const sessionMeta = metadata?.sessions[sessionId];
  return sessionMeta?.customName || fallbackSummary;
};

/** Helper to check if a project should be hidden */
export const isProjectHidden = (
  metadata: UserMetadata | null,
  projectPath: string
): boolean => {
  if (!metadata) return false;

  // Check explicit hidden flag
  const projectMeta = metadata.projects[projectPath];
  if (projectMeta?.hidden) {
    return true;
  }

  // Check hidden patterns
  const patterns = metadata.settings.hiddenPatterns || [];
  for (const pattern of patterns) {
    if (matchGlobPattern(projectPath, pattern)) {
      return true;
    }
  }

  return false;
};
