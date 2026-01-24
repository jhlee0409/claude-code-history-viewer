/**
 * @fileoverview Tests for worktree detection utilities
 * Tests for extractProjectName, isInTmpDirectory, isWorktreeOf, detectWorktreeGroups, getWorktreeLabel
 */
import { describe, it, expect } from "vitest";
import {
  decodeProjectPath,
  extractProjectName,
  isInTmpDirectory,
  isWorktreeOf,
  detectWorktreeGroups,
  getWorktreeLabel,
  detectWorktreeGroupsByGit,
  detectWorktreeGroupsHybrid,
} from "../utils/worktreeUtils";
import type { ClaudeProject } from "../types";

// Helper to create mock ClaudeProject
function createMockProject(overrides: Partial<ClaudeProject> = {}): ClaudeProject {
  return {
    name: overrides.name ?? "test-project",
    path: overrides.path ?? "/Users/test/test-project",
    session_count: overrides.session_count ?? 1,
    message_count: overrides.message_count ?? 10,
    lastModified: overrides.lastModified ?? new Date().toISOString(),
  };
}

describe("decodeProjectPath", () => {
  it("should decode Claude session storage path to actual project path", () => {
    // Note: dashes in the original path become slashes (this is a limitation of Claude's encoding)
    expect(
      decodeProjectPath("/Users/jack/.claude/projects/-Users-jack-client-myproject")
    ).toBe("/Users/jack/client/myproject");
  });

  it("should decode tmp path from session storage", () => {
    expect(
      decodeProjectPath("/Users/jack/.claude/projects/-tmp-featurebranch-myproject")
    ).toBe("/tmp/featurebranch/myproject");
  });

  it("should decode private tmp path from session storage", () => {
    expect(
      decodeProjectPath("/Users/jack/.claude/projects/-private-tmp-vibekanban-myproject")
    ).toBe("/private/tmp/vibekanban/myproject");
  });

  it("should return original path if not a session storage path", () => {
    expect(decodeProjectPath("/Users/jack/client/my-project")).toBe(
      "/Users/jack/client/my-project"
    );
  });

  it("should return original path if no leading dash after marker", () => {
    expect(
      decodeProjectPath("/Users/jack/.claude/projects/some-project")
    ).toBe("/Users/jack/.claude/projects/some-project");
  });

  it("should handle path with home directory", () => {
    expect(
      decodeProjectPath("/home/user/.claude/projects/-home-user-code-project")
    ).toBe("/home/user/code/project");
  });

  it("should handle empty encoded part", () => {
    expect(decodeProjectPath("/Users/jack/.claude/projects/")).toBe(
      "/Users/jack/.claude/projects/"
    );
  });

  it("should handle dashes in project names (they become slashes)", () => {
    // This is expected behavior: Claude encodes /Users/jack/my-project as -Users-jack-my-project
    // When decoded, both path separators and dashes become slashes
    expect(
      decodeProjectPath("/Users/jack/.claude/projects/-Users-jack-my-project")
    ).toBe("/Users/jack/my/project");
  });
});

describe("extractProjectName", () => {
  it("should extract project name from standard path", () => {
    expect(extractProjectName("/Users/jack/my-project")).toBe("my-project");
  });

  it("should extract project name from nested path", () => {
    expect(extractProjectName("/Users/jack/code/projects/my-project")).toBe("my-project");
  });

  it("should handle path with trailing slash", () => {
    expect(extractProjectName("/Users/jack/my-project/")).toBe("my-project");
  });

  it("should extract project name from tmp path", () => {
    expect(extractProjectName("/tmp/vibe-kanban/my-project")).toBe("my-project");
  });

  it("should extract project name from private tmp path", () => {
    expect(extractProjectName("/private/tmp/branch-name/my-project")).toBe("my-project");
  });

  it("should return empty string for root path", () => {
    expect(extractProjectName("/")).toBe("");
  });

  it("should return empty string for empty path", () => {
    expect(extractProjectName("")).toBe("");
  });

  it("should handle single segment path", () => {
    expect(extractProjectName("my-project")).toBe("my-project");
  });

  it("should handle path with special characters", () => {
    expect(extractProjectName("/Users/jack/my-project_v2.0")).toBe("my-project_v2.0");
  });

  it("should extract project name from Claude session storage path", () => {
    // When decoded, dashes become slashes, so the last segment is "project"
    expect(
      extractProjectName("/Users/jack/.claude/projects/-Users-jack-client-myproject")
    ).toBe("myproject");
  });

  it("should extract project name from tmp session storage path", () => {
    expect(
      extractProjectName("/Users/jack/.claude/projects/-tmp-vibekanban-myproject")
    ).toBe("myproject");
  });

  it("should extract same final segment for parent and worktree paths (enabling grouping)", () => {
    // Both paths have the same final segment after decoding, enabling worktree grouping
    const parentPath = "/Users/jack/.claude/projects/-Users-jack-client-myproject";
    const worktreePath = "/Users/jack/.claude/projects/-tmp-vibekanban-myproject";
    expect(extractProjectName(parentPath)).toBe(extractProjectName(worktreePath));
  });
});

describe("isInTmpDirectory", () => {
  it("should return true for /tmp/ path", () => {
    expect(isInTmpDirectory("/tmp/vibe-kanban/my-project")).toBe(true);
  });

  it("should return true for /private/tmp/ path", () => {
    expect(isInTmpDirectory("/private/tmp/branch-name/my-project")).toBe(true);
  });

  it("should return true for root /tmp/ path", () => {
    expect(isInTmpDirectory("/tmp/project")).toBe(true);
  });

  it("should return false for regular user path", () => {
    expect(isInTmpDirectory("/Users/jack/my-project")).toBe(false);
  });

  it("should return false for path containing tmp in middle", () => {
    expect(isInTmpDirectory("/Users/jack/tmp/my-project")).toBe(false);
  });

  it("should return false for path ending with tmp", () => {
    expect(isInTmpDirectory("/Users/jack/mytmp")).toBe(false);
  });

  it("should return false for home directory path", () => {
    expect(isInTmpDirectory("/home/user/project")).toBe(false);
  });

  it("should return false for empty path", () => {
    expect(isInTmpDirectory("")).toBe(false);
  });

  it("should return true for Claude session storage path encoding a tmp path", () => {
    expect(
      isInTmpDirectory("/Users/jack/.claude/projects/-tmp-vibe-kanban-my-project")
    ).toBe(true);
  });

  it("should return true for session storage path encoding /private/tmp/", () => {
    expect(
      isInTmpDirectory("/Users/jack/.claude/projects/-private-tmp-branch-my-project")
    ).toBe(true);
  });

  it("should return false for session storage path encoding non-tmp path", () => {
    expect(
      isInTmpDirectory("/Users/jack/.claude/projects/-Users-jack-client-my-project")
    ).toBe(false);
  });
});

describe("isWorktreeOf", () => {
  it("should return true when child is in tmp and parent is not, with same name", () => {
    expect(
      isWorktreeOf("/Users/jack/my-project", "/tmp/vibe-kanban/my-project")
    ).toBe(true);
  });

  it("should return true for /private/tmp/ worktree", () => {
    expect(
      isWorktreeOf("/Users/jack/my-project", "/private/tmp/feature/my-project")
    ).toBe(true);
  });

  it("should return false when parent is also in tmp", () => {
    expect(
      isWorktreeOf("/tmp/a/my-project", "/tmp/b/my-project")
    ).toBe(false);
  });

  it("should return false when child is not in tmp", () => {
    expect(
      isWorktreeOf("/Users/jack/my-project", "/Users/jack/other/my-project")
    ).toBe(false);
  });

  it("should return false when names don't match", () => {
    expect(
      isWorktreeOf("/Users/jack/my-project", "/tmp/branch/other-project")
    ).toBe(false);
  });

  it("should return false when parent path is empty string", () => {
    expect(isWorktreeOf("", "/tmp/branch/my-project")).toBe(false);
  });

  it("should return false when child path is empty string", () => {
    expect(isWorktreeOf("/Users/jack/my-project", "")).toBe(false);
  });

  it("should return false for same path (not a worktree relationship)", () => {
    expect(
      isWorktreeOf("/Users/jack/my-project", "/Users/jack/my-project")
    ).toBe(false);
  });
});

describe("detectWorktreeGroups", () => {
  it("should return empty groups for empty project list", () => {
    const result = detectWorktreeGroups([]);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toEqual([]);
  });

  it("should return all projects as ungrouped when no worktrees exist", () => {
    const projects = [
      createMockProject({ name: "project-a", path: "/Users/jack/project-a" }),
      createMockProject({ name: "project-b", path: "/Users/jack/project-b" }),
    ];

    const result = detectWorktreeGroups(projects);

    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toHaveLength(2);
    expect(result.ungrouped.map((p) => p.name)).toContain("project-a");
    expect(result.ungrouped.map((p) => p.name)).toContain("project-b");
  });

  it("should group worktree with its parent project", () => {
    const parent = createMockProject({
      name: "my-project",
      path: "/Users/jack/my-project",
    });
    const worktree = createMockProject({
      name: "my-project",
      path: "/tmp/vibe-kanban/my-project",
    });

    const result = detectWorktreeGroups([parent, worktree]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parent.path).toBe("/Users/jack/my-project");
    expect(result.groups[0].children).toHaveLength(1);
    expect(result.groups[0].children[0].path).toBe("/tmp/vibe-kanban/my-project");
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should group multiple worktrees under same parent", () => {
    const parent = createMockProject({
      name: "my-project",
      path: "/Users/jack/my-project",
    });
    const worktree1 = createMockProject({
      name: "my-project",
      path: "/tmp/feature-a/my-project",
    });
    const worktree2 = createMockProject({
      name: "my-project",
      path: "/tmp/feature-b/my-project",
    });

    const result = detectWorktreeGroups([parent, worktree1, worktree2]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].children).toHaveLength(2);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should handle multiple parent projects with their own worktrees", () => {
    const parent1 = createMockProject({
      name: "project-a",
      path: "/Users/jack/project-a",
    });
    const parent2 = createMockProject({
      name: "project-b",
      path: "/Users/jack/project-b",
    });
    const worktree1 = createMockProject({
      name: "project-a",
      path: "/tmp/branch/project-a",
    });
    const worktree2 = createMockProject({
      name: "project-b",
      path: "/tmp/branch/project-b",
    });

    const result = detectWorktreeGroups([parent1, parent2, worktree1, worktree2]);

    expect(result.groups).toHaveLength(2);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should keep tmp projects without parent in ungrouped", () => {
    const parent = createMockProject({
      name: "project-a",
      path: "/Users/jack/project-a",
    });
    const orphanWorktree = createMockProject({
      name: "project-b",
      path: "/tmp/branch/project-b",
    });

    const result = detectWorktreeGroups([parent, orphanWorktree]);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });

  it("should handle mixed grouped and ungrouped projects", () => {
    const parent = createMockProject({
      name: "project-a",
      path: "/Users/jack/project-a",
    });
    const worktree = createMockProject({
      name: "project-a",
      path: "/tmp/branch/project-a",
    });
    const standalone = createMockProject({
      name: "project-b",
      path: "/Users/jack/project-b",
    });

    const result = detectWorktreeGroups([parent, worktree, standalone]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parent.name).toBe("project-a");
    expect(result.ungrouped).toHaveLength(1);
    expect(result.ungrouped[0].name).toBe("project-b");
  });

  it("should handle /private/tmp/ worktrees", () => {
    const parent = createMockProject({
      name: "my-project",
      path: "/Users/jack/my-project",
    });
    const worktree = createMockProject({
      name: "my-project",
      path: "/private/tmp/feature/my-project",
    });

    const result = detectWorktreeGroups([parent, worktree]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].children[0].path).toBe("/private/tmp/feature/my-project");
  });
});

describe("getWorktreeLabel", () => {
  it("should remove /tmp/ prefix", () => {
    expect(getWorktreeLabel("/tmp/vibe-kanban/my-project")).toBe(
      "vibe-kanban/my-project"
    );
  });

  it("should remove /private/tmp/ prefix", () => {
    expect(getWorktreeLabel("/private/tmp/feature-branch/my-project")).toBe(
      "feature-branch/my-project"
    );
  });

  it("should return original path if no tmp prefix", () => {
    expect(getWorktreeLabel("/Users/jack/my-project")).toBe(
      "/Users/jack/my-project"
    );
  });

  it("should handle single directory after tmp", () => {
    expect(getWorktreeLabel("/tmp/my-project")).toBe("my-project");
  });

  it("should handle deeply nested path after tmp", () => {
    expect(getWorktreeLabel("/tmp/a/b/c/my-project")).toBe("a/b/c/my-project");
  });

  it("should return empty string for just /tmp/", () => {
    expect(getWorktreeLabel("/tmp/")).toBe("");
  });

  it("should decode and remove tmp prefix from session storage path", () => {
    expect(
      getWorktreeLabel("/Users/jack/.claude/projects/-tmp-vibekanban-myproject")
    ).toBe("vibekanban/myproject");
  });

  it("should decode and remove private tmp prefix from session storage path", () => {
    expect(
      getWorktreeLabel("/Users/jack/.claude/projects/-private-tmp-feature-myproject")
    ).toBe("feature/myproject");
  });
});

describe("detectWorktreeGroups with session storage paths", () => {
  it("should detect worktree relationship from session storage paths", () => {
    const parent = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-Users-jack-client-myproject",
    });
    const worktree = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-tmp-vibekanban-myproject",
    });

    const result = detectWorktreeGroups([parent, worktree]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parent.path).toBe(
      "/Users/jack/.claude/projects/-Users-jack-client-myproject"
    );
    expect(result.groups[0].children).toHaveLength(1);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should not group session storage paths with different project names", () => {
    const parent = createMockProject({
      name: "projecta",
      path: "/Users/jack/.claude/projects/-Users-jack-client-projecta",
    });
    const worktree = createMockProject({
      name: "projectb",
      path: "/Users/jack/.claude/projects/-tmp-branch-projectb",
    });

    const result = detectWorktreeGroups([parent, worktree]);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });
});

// ============================================================================
// Git-based Detection Tests (100% accurate)
// ============================================================================

describe("detectWorktreeGroupsByGit", () => {
  it("should group linked worktrees with their main repos", () => {
    const mainRepo = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-Users-jack-myproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const linkedWorktree = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-myproject",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/myproject",
    };

    const result = detectWorktreeGroupsByGit([mainRepo, linkedWorktree]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parent.path).toBe(mainRepo.path);
    expect(result.groups[0].children).toHaveLength(1);
    expect(result.groups[0].children[0].path).toBe(linkedWorktree.path);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should leave not_git projects ungrouped", () => {
    const notGitProject = createMockProject({
      name: "no-git",
      path: "/Users/jack/.claude/projects/-Users-jack-no-git",
    });
    notGitProject.git_info = { worktree_type: "not_git" };

    const result = detectWorktreeGroupsByGit([notGitProject]);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(1);
  });

  it("should leave orphan linked worktrees ungrouped", () => {
    // Linked worktree without corresponding main repo in the list
    const linkedWorktree = createMockProject({
      name: "orphan",
      path: "/Users/jack/.claude/projects/-tmp-feature-orphan",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/main-not-in-list",
    };

    const result = detectWorktreeGroupsByGit([linkedWorktree]);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(1);
  });

  it("should handle multiple worktrees under same main repo", () => {
    const mainRepo = createMockProject({
      name: "main",
      path: "/Users/jack/.claude/projects/-Users-jack-main",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const worktree1 = createMockProject({
      name: "main",
      path: "/Users/jack/.claude/projects/-tmp-feature1-main",
    });
    worktree1.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/main",
    };

    const worktree2 = createMockProject({
      name: "main",
      path: "/Users/jack/.claude/projects/-tmp-feature2-main",
    });
    worktree2.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/main",
    };

    const result = detectWorktreeGroupsByGit([mainRepo, worktree1, worktree2]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].children).toHaveLength(2);
    expect(result.ungrouped).toHaveLength(0);
  });
});

describe("detectWorktreeGroupsHybrid", () => {
  it("should use git info when available, heuristic otherwise", () => {
    // Git-based grouping (has git_info)
    const mainRepo = createMockProject({
      name: "gitproject",
      path: "/Users/jack/.claude/projects/-Users-jack-gitproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const linkedWorktree = createMockProject({
      name: "gitproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-gitproject",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/gitproject",
    };

    // Heuristic-based grouping (no git_info)
    const heuristicParent = createMockProject({
      name: "legacyproject",
      path: "/Users/jack/.claude/projects/-Users-jack-legacyproject",
    });

    const heuristicWorktree = createMockProject({
      name: "legacyproject",
      path: "/Users/jack/.claude/projects/-tmp-branch-legacyproject",
    });

    const result = detectWorktreeGroupsHybrid([
      mainRepo,
      linkedWorktree,
      heuristicParent,
      heuristicWorktree,
    ]);

    expect(result.groups).toHaveLength(2);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should prioritize git info over heuristic", () => {
    // Main repo with git_info
    const mainRepo = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-Users-jack-myproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    // Linked worktree with correct git_info
    const linkedWorktree = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-myproject",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/myproject",
    };

    const result = detectWorktreeGroupsHybrid([mainRepo, linkedWorktree]);

    expect(result.groups).toHaveLength(1);
    // Verify it used git-based grouping (parent path matches)
    expect(result.groups[0].parent.git_info?.worktree_type).toBe("main");
  });

  it("should fall back to heuristic for projects without git info", () => {
    const parent = createMockProject({
      name: "noinfo",
      path: "/Users/jack/.claude/projects/-Users-jack-noinfo",
    });
    // No git_info

    const worktree = createMockProject({
      name: "noinfo",
      path: "/Users/jack/.claude/projects/-tmp-feature-noinfo",
    });
    // No git_info

    const result = detectWorktreeGroupsHybrid([parent, worktree]);

    // Should use heuristic and group them
    expect(result.groups).toHaveLength(1);
  });
});
