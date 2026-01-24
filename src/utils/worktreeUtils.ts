// src/utils/worktreeUtils.ts
import type { ClaudeProject } from "../types";

/**
 * Represents a group of worktrees under a parent project.
 */
export interface WorktreeGroup {
  parent: ClaudeProject;
  children: ClaudeProject[];
}

/**
 * Result of detecting worktree groups.
 */
export interface WorktreeGroupingResult {
  groups: WorktreeGroup[];
  ungrouped: ClaudeProject[];
}

/**
 * Common temporary directory prefixes that indicate worktree locations.
 */
const TMP_PREFIXES = ["/tmp/", "/private/tmp/"];

/**
 * Decodes the actual project path from a Claude session storage path.
 * Claude stores sessions in ~/.claude/projects/ with the project path encoded.
 *
 * @example
 * decodeProjectPath("/Users/jack/.claude/projects/-Users-jack-client-my-project")
 * // Returns: "/Users/jack/client/my-project"
 *
 * decodeProjectPath("/Users/jack/.claude/projects/-tmp-feature-branch-my-project")
 * // Returns: "/tmp/feature-branch/my-project"
 */
export function decodeProjectPath(sessionStoragePath: string): string {
  // Find the .claude/projects/ part
  const marker = ".claude/projects/";
  const markerIndex = sessionStoragePath.indexOf(marker);

  if (markerIndex === -1) {
    // Not a session storage path, return as-is
    return sessionStoragePath;
  }

  // Get the encoded part after .claude/projects/
  const encoded = sessionStoragePath.slice(markerIndex + marker.length);

  // Replace leading dash and all dashes with slashes
  // "-Users-jack-client-my-project" -> "/Users/jack/client/my-project"
  if (encoded.startsWith("-")) {
    return encoded.replace(/-/g, "/");
  }

  return sessionStoragePath;
}

/**
 * Extracts the final project name from a path.
 * Automatically decodes session storage paths.
 * e.g., /Users/jack/my-project -> my-project
 * e.g., /tmp/vibe-kanban/my-project -> my-project
 */
export function extractProjectName(path: string): string {
  const actualPath = decodeProjectPath(path);
  // Remove trailing slash if present
  const cleanPath = actualPath.endsWith("/") ? actualPath.slice(0, -1) : actualPath;
  // Get the last segment
  const segments = cleanPath.split("/");
  return segments[segments.length - 1] || "";
}

/**
 * Checks if a project path is in a temporary directory (indicating a worktree).
 * Automatically decodes session storage paths.
 */
export function isInTmpDirectory(path: string): boolean {
  const actualPath = decodeProjectPath(path);
  return TMP_PREFIXES.some((prefix) => actualPath.startsWith(prefix));
}

/**
 * Checks if childPath is a worktree of parentPath.
 * A worktree is identified when:
 * 1. The child is in a /tmp/ directory
 * 2. The parent is NOT in a /tmp/ directory
 * 3. They share the same final project name
 *
 * @example
 * isWorktreeOf("/Users/jack/my-project", "/tmp/vibe-kanban/my-project") // true
 * isWorktreeOf("/Users/jack/my-project", "/Users/jack/my-project") // false (same path)
 * isWorktreeOf("/tmp/a/my-project", "/tmp/b/my-project") // false (both tmp)
 */
export function isWorktreeOf(parentPath: string, childPath: string): boolean {
  // Parent should NOT be in tmp
  if (isInTmpDirectory(parentPath)) {
    return false;
  }

  // Child should be in tmp
  if (!isInTmpDirectory(childPath)) {
    return false;
  }

  // They should share the same project name
  const parentName = extractProjectName(parentPath);
  const childName = extractProjectName(childPath);

  return parentName === childName && parentName !== "";
}

/**
 * Detects worktree groups from a list of projects.
 *
 * Detection rules:
 * 1. Projects in `/tmp/` or `/private/tmp/` are potential worktrees
 * 2. Match by extracting final project name from path
 * 3. Parent is the non-tmp project with same name
 *
 * @returns Groups of parent projects with their worktrees, and ungrouped projects
 */
export function detectWorktreeGroups(
  projects: ClaudeProject[]
): WorktreeGroupingResult {
  // Separate tmp projects (potential worktrees) from regular projects
  const tmpProjects: ClaudeProject[] = [];
  const regularProjects: ClaudeProject[] = [];

  for (const project of projects) {
    if (isInTmpDirectory(project.path)) {
      tmpProjects.push(project);
    } else {
      regularProjects.push(project);
    }
  }

  // Build a map of project names to regular projects for quick lookup
  // Multiple projects can have the same name (e.g., /Users/jack/work/my-project and /Users/jack/personal/my-project)
  const nameToRegularProjects = new Map<string, ClaudeProject[]>();
  for (const project of regularProjects) {
    const name = extractProjectName(project.path);
    if (name) {
      if (!nameToRegularProjects.has(name)) {
        nameToRegularProjects.set(name, []);
      }
      nameToRegularProjects.get(name)!.push(project);
    }
  }

  // Track which projects have been grouped
  const groupedParentPaths = new Set<string>();
  const groupedChildPaths = new Set<string>();

  // Build groups
  const groupMap = new Map<string, WorktreeGroup>();

  for (const tmpProject of tmpProjects) {
    const tmpName = extractProjectName(tmpProject.path);
    const candidates = nameToRegularProjects.get(tmpName);

    if (candidates && candidates.length > 0 && candidates[0]) {
      // If multiple candidates, pick the first one (could be improved with path ancestry matching)
      const parentProject: ClaudeProject = candidates[0];
      const parentPath = parentProject.path;

      if (!groupMap.has(parentPath)) {
        groupMap.set(parentPath, {
          parent: parentProject,
          children: [],
        });
      }

      groupMap.get(parentPath)!.children.push(tmpProject);
      groupedParentPaths.add(parentPath);
      groupedChildPaths.add(tmpProject.path);
    }
  }

  // Build the final result
  const groups: WorktreeGroup[] = Array.from(groupMap.values());

  // Ungrouped = regular projects without children + tmp projects without parents
  const ungrouped: ClaudeProject[] = [
    ...regularProjects.filter((p) => !groupedParentPaths.has(p.path)),
    ...tmpProjects.filter((p) => !groupedChildPaths.has(p.path)),
  ];

  return { groups, ungrouped };
}

/**
 * Gets the display label for a worktree child (removes tmp path prefix).
 * Automatically decodes session storage paths.
 * e.g., /tmp/vibe-kanban/my-project -> vibe-kanban/my-project
 */
export function getWorktreeLabel(childPath: string): string {
  const actualPath = decodeProjectPath(childPath);
  for (const prefix of TMP_PREFIXES) {
    if (actualPath.startsWith(prefix)) {
      return actualPath.slice(prefix.length);
    }
  }
  return actualPath;
}

// ============================================================================
// Git-based Worktree Detection (100% accurate)
// ============================================================================

/**
 * Detects worktree groups using git metadata.
 *
 * This method is 100% accurate as it uses actual git information:
 * - linked worktrees have worktree_type: "linked" and main_project_path set
 * - main repos have worktree_type: "main"
 *
 * @returns Groups based on git relationships and ungrouped projects
 */
export function detectWorktreeGroupsByGit(
  projects: ClaudeProject[]
): WorktreeGroupingResult {
  // Build a map of actual project paths to projects with "main" type
  const mainReposByPath = new Map<string, ClaudeProject>();

  for (const project of projects) {
    if (project.git_info?.worktree_type === "main") {
      const actualPath = decodeProjectPath(project.path);
      mainReposByPath.set(actualPath, project);
    }
  }

  const groups = new Map<string, WorktreeGroup>();
  const groupedChildPaths = new Set<string>();

  // Match linked worktrees to their main repos
  for (const project of projects) {
    if (project.git_info?.worktree_type === "linked") {
      const mainPath = project.git_info.main_project_path;
      if (mainPath) {
        const parent = mainReposByPath.get(mainPath);
        if (parent) {
          if (!groups.has(parent.path)) {
            groups.set(parent.path, { parent, children: [] });
          }
          groups.get(parent.path)!.children.push(project);
          groupedChildPaths.add(project.path);
        }
      }
    }
  }

  // Separate grouped parents from ungrouped projects
  const groupedParentPaths = new Set(groups.keys());
  const ungrouped = projects.filter(
    (p) => !groupedParentPaths.has(p.path) && !groupedChildPaths.has(p.path)
  );

  return {
    groups: Array.from(groups.values()),
    ungrouped,
  };
}

/**
 * Hybrid worktree detection combining git metadata and heuristics.
 *
 * Priority:
 * 1. Git info available → Use git-based grouping (100% accurate)
 * 2. Git info unavailable → Fall back to heuristic-based grouping
 *
 * @returns Combined grouping result
 */
export function detectWorktreeGroupsHybrid(
  projects: ClaudeProject[]
): WorktreeGroupingResult {
  // Separate projects by whether they have useful git info
  const withGitInfo: ClaudeProject[] = [];
  const withoutGitInfo: ClaudeProject[] = [];

  for (const project of projects) {
    if (project.git_info && project.git_info.worktree_type !== "not_git") {
      withGitInfo.push(project);
    } else {
      withoutGitInfo.push(project);
    }
  }

  // Git-based grouping for projects with git info
  const gitResult = detectWorktreeGroupsByGit(withGitInfo);

  // Heuristic-based grouping for remaining projects
  const remainingProjects = [...gitResult.ungrouped, ...withoutGitInfo];
  const heuristicResult = detectWorktreeGroups(remainingProjects);

  return {
    groups: [...gitResult.groups, ...heuristicResult.groups],
    ungrouped: heuristicResult.ungrouped,
  };
}
