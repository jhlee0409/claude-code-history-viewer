import type { ClaudeMessage, ClaudeProject } from "@/types";
import { getPathLeaf } from "./pathUtils";

/** Paths and virtual URIs are opaque; provider namespaces may share a path. */
export const projectIdentityKey = (project: Pick<ClaudeProject, "provider" | "path">): string =>
  JSON.stringify([project.provider ?? "claude", project.path]);

/** A name-only result can identify a project only when there is one candidate. */
export function projectForSearchResult(
  result: ClaudeMessage,
  projects: readonly ClaudeProject[],
): ClaudeProject | undefined {
  const provider = result.provider ?? "claude";
  const candidates = projects.filter((project) => (project.provider ?? "claude") === provider);
  if (result.projectPath != null) return candidates.find((project) => project.path === result.projectPath);
  if (!result.projectName) return undefined;
  const named = candidates.filter((project) =>
    project.name === result.projectName || getPathLeaf(project.path) === result.projectName,
  );
  return named.length === 1 ? named[0] : undefined;
}
