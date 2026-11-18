/**
 * The palette's "Sidebar filter" scope: Sessions and Messages cover only what
 * the sidebar filter shows.
 *
 * A project the filter matched by its own name counts with all its sessions;
 * a project shown only because some of its sessions matched counts with just
 * those. The backend narrows every provider's results to those projects by
 * exact path (`projectPaths`) and, when every session in view is known, by
 * session id. The same rules are then applied here, per project, to every
 * result: that covers a session id list that could not be built (a
 * name-matched project whose sessions are not loaded).
 */

import type { ClaudeMessage, ClaudeProject } from "@/types";
import type { SidebarFilterResult } from "@/store/slices/sidebarFilterSlice";
import type { SessionRef } from "@/navigation/place";
import { projectForSearchResult } from "@/utils/projectIdentity";

export interface SidebarSearchScope {
  /** The projects the sidebar shows. */
  projects: ClaudeProject[];
  /** For the backend's `sessionIds` filter; null when it can't be built. */
  sessionIds: string[] | null;
  sessionIdSet: ReadonlySet<string> | null;
  /**
   * Projects shown only for some of their sessions, mapped to the ids
   * (`session_id` and `actual_session_id`) of those sessions.
   */
  sessionIdsByProject: ReadonlyMap<string, ReadonlySet<string>>;
}

const providerOf = (p: { provider?: string | null }): string => p.provider ?? "claude";

/** Null when the sidebar is not filtered or shows no project. */
export const buildSidebarSearchScope = (
  projects: readonly ClaudeProject[],
  filterResult: SidebarFilterResult | null
): SidebarSearchScope | null => {
  if (!filterResult) return null;
  const inView = new Set(filterResult.projectPaths);
  const scoped = projects.filter((project) => inView.has(project.path));
  if (scoped.length === 0) return null;

  const sessionIdsByProject = new Map<string, Set<string>>();
  for (const [path, sessions] of Object.entries(filterResult.sessionMatchesByProject)) {
    const ids = new Set<string>();
    for (const session of sessions) {
      ids.add(session.session_id);
      if (session.actual_session_id) ids.add(session.actual_session_id);
    }
    sessionIdsByProject.set(path, ids);
  }

  return {
    projects: scoped,
    sessionIds: filterResult.sessionIds,
    sessionIdSet: filterResult.sessionIds ? new Set(filterResult.sessionIds) : null,
    sessionIdsByProject,
  };
};

/**
 * Whether a message result is in the scope. Its project is resolved against
 * `allProjects` by the rule the Messages group groups on (exact path when the
 * result carries one, else an unambiguous name); a result whose project can't
 * be resolved (some providers label results loosely) is judged by the
 * session id list alone, or kept when there is none.
 */
export const isResultInScope = (
  result: ClaudeMessage,
  scope: SidebarSearchScope,
  allProjects: readonly ClaudeProject[]
): boolean => {
  const owner = projectForSearchResult(result, allProjects);
  if (!owner) return scope.sessionIdSet ? scope.sessionIdSet.has(result.sessionId) : true;
  if (!scope.projects.some((project) => project.path === owner.path)) return false;
  const matched = scope.sessionIdsByProject.get(owner.path);
  return matched ? matched.has(result.sessionId) : true;
};

/** Whether a session (by its place ref) is in the scope. */
export const isSessionRefInScope = (ref: SessionRef, scope: SidebarSearchScope): boolean => {
  const project = scope.projects.find(
    (candidate) => providerOf(candidate) === ref.provider && candidate.path === ref.projectPath
  );
  if (!project) return false;
  const matched = scope.sessionIdsByProject.get(project.path);
  return matched
    ? matched.has(ref.sessionId) || (ref.actualSessionId != null && matched.has(ref.actualSessionId))
    : true;
};
