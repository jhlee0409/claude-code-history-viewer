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

export interface LabeledRow {
  /** What the row shows as its name. */
  label: string;
  /**
   * Ways to tell the row apart by level, most readable first (e.g. the
   * project's real folder, then its opaque identity). Rows sharing a label
   * should list the same kinds of hint at the same level.
   */
  hints: readonly (string | undefined)[];
}

/**
 * A secondary line for each row whose label another row also shows, or
 * undefined for a row whose label is unique. Rows sharing a label all use the
 * first hint level that tells them apart (the last level when none does), so
 * internal identities only surface when nothing readable distinguishes them.
 */
export function collisionHints(rows: readonly LabeledRow[]): (string | undefined)[] {
  const byLabel = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const same = byLabel.get(row.label);
    if (same) same.push(index);
    else byLabel.set(row.label, [index]);
  });

  const hints: (string | undefined)[] = rows.map(() => undefined);
  for (const indices of byLabel.values()) {
    if (indices.length < 2) continue;
    const levels = Math.max(...indices.map((index) => rows[index]!.hints.length));
    const hintAt = (index: number, level: number) => {
      const own = rows[index]!.hints;
      return own[Math.min(level, own.length - 1)];
    };
    let level = 0;
    while (level < levels - 1 && new Set(indices.map((index) => hintAt(index, level))).size < indices.length) level++;
    for (const index of indices) hints[index] = hintAt(index, level);
  }
  return hints;
}
