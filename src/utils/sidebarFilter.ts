/**
 * Sidebar filter matching.
 *
 * The project explorer filter can match project names, session names, or
 * both (OR). This module holds the pure matching rules so the tree, the
 * session list and anything else that needs to know "what is the sidebar
 * showing right now" agree on one definition.
 *
 * Names (project name, custom session name, summary) match when they contain
 * the query, or fuzzily (abbreviations, one typo; see `fuzzyTitleMatch`).
 * Paths and session ids match by substring only.
 */

import type { ClaudeProject, ClaudeSession } from "@/types";
import { ancestorIds } from "./sessionBranches";
import {
  compileFuzzyTitleQuery,
  fuzzyTitleMatches,
  type FuzzyTitleQuery,
} from "./fuzzyTitleMatch";

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
  /** Nonmatching ancestors shown as context, not included in search scope. */
  sessionContextByProject: Map<string, ClaudeSession[]>;
}

export const normalizeSidebarQuery = (query: string): string =>
  query.trim().toLowerCase();

/** A normalized query prepared for matching. */
export interface SidebarQuery {
  text: string;
  /** Null when the query is too short for fuzzy matching. */
  fuzzy: FuzzyTitleQuery | null;
}

/** `query` must already be normalized. */
export const compileSidebarQuery = (query: string): SidebarQuery => ({
  text: query,
  fuzzy: compileFuzzyTitleQuery(query),
});

const nameMatches = (name: string | null | undefined, query: SidebarQuery): boolean =>
  !!name &&
  (name.toLowerCase().includes(query.text) ||
    (query.fuzzy !== null && fuzzyTitleMatches(query.fuzzy, name)));

export const projectMatchesQuery = (project: ClaudeProject, query: SidebarQuery): boolean => {
  if (!query.text) return true;
  const path = (project.actual_path ?? project.path ?? "").toLowerCase();
  return path.includes(query.text) || nameMatches(project.name, query);
};

/**
 * `customNames` maps session id to the user's app-only name, which wins over
 * the summary in the UI, so both are searched.
 */
export const sessionMatchesQuery = (
  session: ClaudeSession,
  query: SidebarQuery,
  customNames: Record<string, { customName?: string } | undefined>
): boolean => {
  if (!query.text) return true;
  return (
    session.session_id.toLowerCase().includes(query.text) ||
    nameMatches(customNames[session.session_id]?.customName, query) ||
    nameMatches(session.summary, query)
  );
};

/**
 * Apply the filter to `projects`. `query` must already be normalized.
 * `sessionsByProject` only needs entries for projects whose sessions are
 * known; a project without an entry can only match by name.
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
  const sessionContextByProject = new Map<string, ClaudeSession[]>();
  const compiled = compileSidebarQuery(query);

  for (const project of projects) {
    if (!query || (scope.matchProjects && projectMatchesQuery(project, compiled))) {
      projectPaths.add(project.path);
      continue;
    }
    if (!scope.matchSessions) continue;

    const sessions = sessionsByProject.get(project.path) ?? [];
    const matching = sessions.filter((session) =>
      sessionMatchesQuery(session, compiled, customNames)
    );
    if (matching.length > 0) {
      projectPaths.add(project.path);
      sessionMatchesByProject.set(project.path, matching);
      if (matching.some((session) => session.parent_session_id)) {
        const byId = new Map(sessions.map((session) => [session.session_id, session]));
        const matches = new Set(matching.map((session) => session.session_id));
        const ancestors = new Set(matching.flatMap((session) => ancestorIds(byId, session.session_id)));
        const context = [...ancestors].filter((id) => !matches.has(id)).map((id) => byId.get(id)!);
        if (context.length) sessionContextByProject.set(project.path, context);
      }
    }
  }

  return { projectPaths, sessionMatchesByProject, sessionContextByProject };
};

/**
 * Every session id the filter lets through, for scoping message search. A
 * project matched by its own name contributes all its sessions, so this
 * needs their lists too; returns null (no session-level restriction) when
 * any of them is not loaded yet.
 *
 * Both `session_id` and `actual_session_id` are included: messages carry the
 * latter, which differs from the former for some providers.
 */
export const collectScopedSessionIds = (
  matches: SidebarFilterMatches,
  sessionsByProject: ReadonlyMap<string, readonly ClaudeSession[]>
): string[] | null => {
  const ids = new Set<string>();
  for (const path of matches.projectPaths) {
    const sessions = matches.sessionMatchesByProject.get(path) ?? sessionsByProject.get(path);
    if (!sessions) return null;
    for (const session of sessions) {
      ids.add(session.session_id);
      if (session.actual_session_id) ids.add(session.actual_session_id);
    }
  }
  return [...ids];
};
