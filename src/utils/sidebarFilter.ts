/**
 * Sidebar filter matching.
 *
 * The project explorer filter can match project names, session names, or
 * both (OR). This module holds the pure matching rules so the tree, the
 * session list and anything else that needs to know "what is the sidebar
 * showing right now" agree on one definition.
 */

import type { ClaudeProject, ClaudeSession } from "@/types";

export interface SidebarFilterScope {
  /** Match the project name / path. */
  matchProjects: boolean;
  /** Match session names (custom name, summary) and session ids. */
  matchSessions: boolean;
}

export interface SidebarFilterMatches {
  /** Paths of projects that pass the filter. */
  projectPaths: Set<string>;
  /**
   * Projects that only pass because some of their sessions match, mapped to
   * those sessions. A project matched by its own name is absent here: all of
   * its sessions stay visible.
   */
  sessionMatchesByProject: Map<string, ClaudeSession[]>;
}

export const normalizeSidebarQuery = (query: string): string =>
  query.trim().toLowerCase();

/** `query` must already be normalized. */
export const projectMatchesQuery = (project: ClaudeProject, query: string): boolean => {
  if (!query) return true;
  const name = (project.name ?? "").toLowerCase();
  const path = (project.actual_path ?? project.path ?? "").toLowerCase();
  return name.includes(query) || path.includes(query);
};

/**
 * `query` must already be normalized. `customNames` maps session id to the
 * user's app-only name, which wins over the summary in the UI, so both are
 * searched.
 */
export const sessionMatchesQuery = (
  session: ClaudeSession,
  query: string,
  customNames: Record<string, { customName?: string } | undefined>
): boolean => {
  if (!query) return true;
  const customName = customNames[session.session_id]?.customName;
  return (
    (customName?.toLowerCase().includes(query) ?? false) ||
    (session.summary?.toLowerCase().includes(query) ?? false) ||
    session.session_id.toLowerCase().includes(query)
  );
};

/**
 * Apply the filter to `projects`. `sessionsByProject` only needs entries for
 * projects whose sessions are known; a project without an entry can only
 * match by name.
 */
export const computeSidebarMatches = (
  projects: readonly ClaudeProject[],
  query: string,
  scope: SidebarFilterScope,
  sessionsByProject: ReadonlyMap<string, readonly ClaudeSession[]>,
  customNames: Record<string, { customName?: string } | undefined>
): SidebarFilterMatches => {
  const projectPaths = new Set<string>();
  const sessionMatchesByProject = new Map<string, ClaudeSession[]>();

  for (const project of projects) {
    if (!query || (scope.matchProjects && projectMatchesQuery(project, query))) {
      projectPaths.add(project.path);
      continue;
    }
    if (!scope.matchSessions) continue;

    const matching = (sessionsByProject.get(project.path) ?? []).filter((session) =>
      sessionMatchesQuery(session, query, customNames)
    );
    if (matching.length > 0) {
      projectPaths.add(project.path);
      sessionMatchesByProject.set(project.path, matching);
    }
  }

  return { projectPaths, sessionMatchesByProject };
};
