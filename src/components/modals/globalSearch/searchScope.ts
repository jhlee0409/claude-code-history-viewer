/**
 * Message search scope derived from the sidebar filter.
 *
 * When the sidebar is filtered, message search covers only what the sidebar
 * shows. The backend narrows Claude (and Codex) results by project directory
 * name and session id; providers that do not apply search filters are
 * narrowed here, on the results, with the same rules.
 */

import type { ClaudeMessage, ClaudeProject } from "@/types";
import type { SidebarFilterResult } from "@/store/slices/sidebarFilterSlice";
import { getPathLeaf } from "@/utils/pathUtils";

export interface MessageSearchScope {
  projects: ClaudeProject[];
  /** Names a result's `projectName` may carry for these projects. */
  projectNames: string[];
  /** Null when only projects are restricted. */
  sessionIds: Set<string> | null;
}

export const buildMessageSearchScope = (
  projects: readonly ClaudeProject[],
  filterResult: SidebarFilterResult | null
): MessageSearchScope | null => {
  if (!filterResult) return null;
  const inView = new Set(filterResult.projectPaths);
  const scopedProjects = projects.filter((project) => inView.has(project.path));
  const projectNames = new Set<string>();
  for (const project of scopedProjects) {
    projectNames.add(project.name);
    projectNames.add(getPathLeaf(project.path));
  }
  return {
    projects: scopedProjects,
    projectNames: [...projectNames].filter(Boolean),
    sessionIds: filterResult.sessionIds ? new Set(filterResult.sessionIds) : null,
  };
};

/** The project a result belongs to, by the same rule the result list groups on. */
export const findResultProject = <P extends ClaudeProject>(
  result: ClaudeMessage,
  projects: readonly P[]
): P | undefined => {
  const resultProvider = result.provider ?? "claude";
  const projectName = result.projectName;
  if (!projectName) return undefined;
  return projects.find(
    (project) =>
      (project.provider ?? "claude") === resultProvider &&
      (project.name === projectName || getPathLeaf(project.path) === projectName)
  );
};

/**
 * Whether a result is inside the scope. A result whose project can't be
 * resolved against `allProjects` (some providers label results loosely) is
 * judged by session id alone, or kept when sessions aren't restricted.
 */
export const isResultInScope = (
  result: ClaudeMessage,
  scope: MessageSearchScope,
  allProjects: readonly ClaudeProject[]
): boolean => {
  if (scope.sessionIds && !scope.sessionIds.has(result.sessionId)) return false;
  const owner = findResultProject(result, allProjects);
  if (!owner) return true;
  return scope.projects.some((project) => project.path === owner.path);
};
