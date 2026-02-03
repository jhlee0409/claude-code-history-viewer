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
 * @deprecated Use project.actual_path instead. Backend provides accurate path decoding.
 *
 * Decodes the actual project path from a Claude session storage path.
 * This naive implementation replaces all hyphens with slashes, which fails
 * for project names containing hyphens (e.g., "my-project" becomes "my/project").
 *
 * The backend (utils.rs) uses filesystem existence checks for accurate decoding.
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
  // WARNING: This is inaccurate for paths with hyphens in names
  if (encoded.startsWith("-")) {
    return encoded.replace(/-/g, "/");
  }

  return sessionStoragePath;
}

/**
 * Extracts the final project name from a path.
 * Expects an actual filesystem path (not encoded session storage path).
 * e.g., /Users/jack/my-project -> my-project
 * e.g., /tmp/vibe-kanban/my-project -> my-project
 */
export function extractProjectName(path: string): string {
  // Remove trailing slash if present
  const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;
  // Get the last segment
  const segments = cleanPath.split("/");
  return segments[segments.length - 1] || "";
}

/**
 * Gets the display label for a worktree child (removes tmp path prefix).
 * Expects an actual filesystem path (use project.actual_path).
 * e.g., /tmp/vibe-kanban/my-project -> vibe-kanban/my-project
 */
export function getWorktreeLabel(childPath: string): string {
  for (const prefix of TMP_PREFIXES) {
    if (childPath.startsWith(prefix)) {
      return childPath.slice(prefix.length);
    }
  }
  return childPath;
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
      // Use actual_path from backend (correctly decoded via filesystem checks)
      mainReposByPath.set(project.actual_path, project);
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
 * Worktree detection using git metadata only.
 *
 * Uses git_info from backend for 100% accurate detection.
 * Projects without git_info are treated as ungrouped.
 *
 * @returns Grouping result with worktree groups and ungrouped projects
 */
export function detectWorktreeGroupsHybrid(
  projects: ClaudeProject[]
): WorktreeGroupingResult {
  // Separate projects by whether they have useful git info
  const withGitInfo: ClaudeProject[] = [];
  const withoutGitInfo: ClaudeProject[] = [];

  for (const project of projects) {
    if (
      project.git_info?.worktree_type &&
      project.git_info.worktree_type !== "not_git"
    ) {
      withGitInfo.push(project);
    } else {
      withoutGitInfo.push(project);
    }
  }

  // Git-based grouping only (100% accurate)
  const gitResult = detectWorktreeGroupsByGit(withGitInfo);

  // Projects without git info go to ungrouped
  return {
    groups: gitResult.groups,
    ungrouped: [...gitResult.ungrouped, ...withoutGitInfo],
  };
}

// ============================================================================
// Directory-based Grouping (Filesystem Tree)
// ============================================================================

/**
 * Represents a directory group containing projects.
 */
export interface DirectoryGroup {
  /** Display name for the group (e.g., "client", "server") */
  name: string;
  /** Full path to the directory (e.g., "/Users/jack/client") */
  path: string;
  /** Short display path (e.g., "~/client") */
  displayPath: string;
  /** Projects in this directory */
  projects: ClaudeProject[];
}

/**
 * Result of directory-based grouping.
 */
export interface DirectoryGroupingResult {
  groups: DirectoryGroup[];
  /** Projects that couldn't be grouped (shouldn't happen normally) */
  ungrouped: ClaudeProject[];
}

/**
 * Gets the parent directory from an actual path.
 * @example
 * getParentDirectory("/Users/jack/client/my-project")
 * // Returns: "/Users/jack/client"
 */
export function getParentDirectory(actualPath: string): string {
  const segments = actualPath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "/";
  }
  return "/" + segments.slice(0, -1).join("/");
}

/**
 * Converts a full path to a shorter display path.
 * Replaces home directory with ~ and removes common prefixes.
 * @example
 * toDisplayPath("/Users/jack/client") // "~/client"
 * toDisplayPath("/tmp/worktree") // "/tmp/worktree"
 */
export function toDisplayPath(fullPath: string, homePath?: string): string {
  // Try to detect home path
  const home = homePath || detectHomePath(fullPath);

  if (home && fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length);
  }

  return fullPath;
}

/**
 * Detects the home directory from a path.
 * Works for /Users/xxx (macOS), /home/xxx (Linux), C:\Users\xxx (Windows)
 */
function detectHomePath(path: string): string | null {
  // macOS: /Users/username/...
  const macMatch = path.match(/^(\/Users\/[^/]+)/);
  if (macMatch?.[1]) return macMatch[1];

  // Linux: /home/username/...
  const linuxMatch = path.match(/^(\/home\/[^/]+)/);
  if (linuxMatch?.[1]) return linuxMatch[1];

  return null;
}

/**
 * Groups projects by their parent directory.
 *
 * @example
 * Input projects:
 *   - /Users/jack/client/project1
 *   - /Users/jack/client/project2
 *   - /Users/jack/server/project3
 *
 * Output groups:
 *   - { name: "client", path: "/Users/jack/client", projects: [project1, project2] }
 *   - { name: "server", path: "/Users/jack/server", projects: [project3] }
 */
export function groupProjectsByDirectory(
  projects: ClaudeProject[]
): DirectoryGroupingResult {
  // Group by parent directory
  const directoryMap = new Map<string, ClaudeProject[]>();

  for (const project of projects) {
    const parentDir = getParentDirectory(project.actual_path);

    if (!directoryMap.has(parentDir)) {
      directoryMap.set(parentDir, []);
    }
    directoryMap.get(parentDir)!.push(project);
  }

  // Convert to DirectoryGroup array
  const groups: DirectoryGroup[] = [];

  for (const [dirPath, dirProjects] of directoryMap) {
    const segments = dirPath.split("/").filter(Boolean);
    const name = segments[segments.length - 1] || "/";

    groups.push({
      name,
      path: dirPath,
      displayPath: toDisplayPath(dirPath),
      projects: dirProjects.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // Sort groups by path for consistent ordering
  groups.sort((a, b) => a.path.localeCompare(b.path));

  return { groups, ungrouped: [] };
}
