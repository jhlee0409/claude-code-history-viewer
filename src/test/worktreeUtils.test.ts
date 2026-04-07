/**
 * @fileoverview Tests for worktree detection utilities
 * Tests for extractProjectName, getWorktreeLabel, detectWorktreeGroupsByGit, etc.
 */
import { describe, it, expect } from "vitest";
import {
  decodeProjectPath,
  extractProjectName,
  getWorktreeLabel,
  detectWorktreeGroupsByGit,
  detectWorktreeGroupsHybrid,
  getParentDirectory,
  toDisplayPath,
  groupProjectsByDirectory,
} from "../utils/worktreeUtils";
import type { ClaudeProject } from "../types";

// Helper to create mock ClaudeProject
function createMockProject(overrides: Partial<ClaudeProject> = {}): ClaudeProject {
  const path = overrides.path ?? "/Users/test/test-project";
  return {
    name: overrides.name ?? "test-project",
    path,
    actual_path: overrides.actual_path ?? path,
    session_count: overrides.session_count ?? 1,
    message_count: overrides.message_count ?? 10,
    last_modified: overrides.last_modified ?? new Date().toISOString(),
    git_info: overrides.git_info,
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

  it("should extract project name from actual_path (not session storage path)", () => {
    // Use actual_path which is already decoded by backend
    expect(extractProjectName("/Users/jack/client/myproject")).toBe("myproject");
  });

  it("should extract project name from tmp actual_path", () => {
    expect(extractProjectName("/tmp/vibekanban/myproject")).toBe("myproject");
  });

  it("should extract same final segment for parent and worktree actual_paths", () => {
    // Both paths have the same project name, enabling worktree grouping
    const parentPath = "/Users/jack/client/myproject";
    const worktreePath = "/tmp/vibekanban/myproject";
    expect(extractProjectName(parentPath)).toBe(extractProjectName(worktreePath));
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

  it("should handle actual_path from tmp worktree", () => {
    // Use actual_path which is already decoded by backend
    expect(getWorktreeLabel("/tmp/vibekanban/myproject")).toBe("vibekanban/myproject");
  });

  it("should handle actual_path from private tmp worktree", () => {
    expect(getWorktreeLabel("/private/tmp/feature/myproject")).toBe("feature/myproject");
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
      actual_path: "/Users/jack/myproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const linkedWorktree = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-myproject",
      actual_path: "/tmp/feature/myproject",
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
      actual_path: "/Users/jack/no-git",
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
      actual_path: "/tmp/feature/orphan",
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
      actual_path: "/Users/jack/main",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const worktree1 = createMockProject({
      name: "main",
      path: "/Users/jack/.claude/projects/-tmp-feature1-main",
      actual_path: "/tmp/feature1/main",
    });
    worktree1.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/main",
    };

    const worktree2 = createMockProject({
      name: "main",
      path: "/Users/jack/.claude/projects/-tmp-feature2-main",
      actual_path: "/tmp/feature2/main",
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

// ============================================================================
// Directory-based Grouping Tests
// ============================================================================

describe("getParentDirectory", () => {
  it("should extract parent directory from standard path", () => {
    expect(getParentDirectory("/Users/jack/client/my-project")).toBe(
      "/Users/jack/client"
    );
  });

  it("should extract parent from deeply nested path", () => {
    expect(getParentDirectory("/Users/jack/code/work/clients/acme/project")).toBe(
      "/Users/jack/code/work/clients/acme"
    );
  });

  it("should return / for root-level path", () => {
    expect(getParentDirectory("/project")).toBe("/");
  });

  it("should return / for single segment", () => {
    expect(getParentDirectory("project")).toBe("/");
  });

  it("should handle tmp paths", () => {
    expect(getParentDirectory("/tmp/feature-branch/my-project")).toBe(
      "/tmp/feature-branch"
    );
  });

  it("should handle Linux home paths", () => {
    expect(getParentDirectory("/home/user/projects/app")).toBe(
      "/home/user/projects"
    );
  });

  it("should handle paths with trailing content", () => {
    expect(getParentDirectory("/Users/jack/client/project-name")).toBe(
      "/Users/jack/client"
    );
  });
});

describe("toDisplayPath", () => {
  it("should convert macOS home path to ~", () => {
    expect(toDisplayPath("/Users/jack/client")).toBe("~/client");
  });

  it("should convert Linux home path to ~", () => {
    expect(toDisplayPath("/home/user/projects")).toBe("~/projects");
  });

  it("should not modify tmp paths", () => {
    expect(toDisplayPath("/tmp/worktree")).toBe("/tmp/worktree");
  });

  it("should not modify private tmp paths", () => {
    expect(toDisplayPath("/private/tmp/feature")).toBe("/private/tmp/feature");
  });

  it("should handle deeply nested home paths", () => {
    expect(toDisplayPath("/Users/jack/code/work/clients")).toBe(
      "~/code/work/clients"
    );
  });

  it("should use explicit homePath when provided", () => {
    expect(toDisplayPath("/custom/home/projects", "/custom/home")).toBe(
      "~/projects"
    );
  });

  it("should not modify path if homePath doesn't match", () => {
    expect(toDisplayPath("/other/path/projects", "/Users/jack")).toBe(
      "/other/path/projects"
    );
  });

  it("should handle Windows paths with forward slashes", () => {
    // Windows paths: home dir C:/Users/jack is replaced with ~
    expect(toDisplayPath("C:/Users/jack/Documents")).toBe("~/Documents");
  });

  it("should handle Windows paths with backslashes", () => {
    // Windows paths: home dir C:\Users\jack is replaced with ~
    expect(toDisplayPath("C:\\Users\\jack\\Documents")).toBe("~\\Documents");
  });
});

describe("groupProjectsByDirectory", () => {
  it("should return empty result for empty project list", () => {
    const result = groupProjectsByDirectory([]);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toEqual([]);
  });

  it("should group projects in same directory", () => {
    const projects = [
      createMockProject({
        name: "project-a",
        path: "/path/a",
        actual_path: "/Users/jack/client/project-a",
      }),
      createMockProject({
        name: "project-b",
        path: "/path/b",
        actual_path: "/Users/jack/client/project-b",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe("client");
    expect(result.groups[0].path).toBe("/Users/jack/client");
    expect(result.groups[0].displayPath).toBe("~/client");
    expect(result.groups[0].projects).toHaveLength(2);
  });

  it("should create separate groups for different directories", () => {
    const projects = [
      createMockProject({
        name: "frontend",
        path: "/path/a",
        actual_path: "/Users/jack/client/frontend",
      }),
      createMockProject({
        name: "backend",
        path: "/path/b",
        actual_path: "/Users/jack/server/backend",
      }),
      createMockProject({
        name: "shared",
        path: "/path/c",
        actual_path: "/Users/jack/libs/shared",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((g) => g.name).sort()).toEqual(["client", "libs", "server"]);
  });

  it("should sort projects within groups alphabetically", () => {
    const projects = [
      createMockProject({
        name: "zebra",
        path: "/path/z",
        actual_path: "/Users/jack/client/zebra",
      }),
      createMockProject({
        name: "apple",
        path: "/path/a",
        actual_path: "/Users/jack/client/apple",
      }),
      createMockProject({
        name: "mango",
        path: "/path/m",
        actual_path: "/Users/jack/client/mango",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups[0].projects.map((p) => p.name)).toEqual([
      "apple",
      "mango",
      "zebra",
    ]);
  });

  it("should sort groups by path", () => {
    const projects = [
      createMockProject({
        name: "z-project",
        path: "/path/z",
        actual_path: "/Users/jack/z-folder/z-project",
      }),
      createMockProject({
        name: "a-project",
        path: "/path/a",
        actual_path: "/Users/jack/a-folder/a-project",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups[0].name).toBe("a-folder");
    expect(result.groups[1].name).toBe("z-folder");
  });

  it("should handle mixed regular and tmp projects", () => {
    const projects = [
      createMockProject({
        name: "main-app",
        path: "/path/a",
        actual_path: "/Users/jack/client/main-app",
      }),
      createMockProject({
        name: "worktree-app",
        path: "/path/b",
        actual_path: "/tmp/feature/worktree-app",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups).toHaveLength(2);
    const groupNames = result.groups.map((g) => g.name);
    expect(groupNames).toContain("client");
    expect(groupNames).toContain("feature");
  });

  it("should handle projects at root level", () => {
    const projects = [
      createMockProject({
        name: "root-project",
        path: "/path/r",
        actual_path: "/root-project",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe("/");
    expect(result.groups[0].path).toBe("/");
  });

  it("should preserve project metadata in groups", () => {
    const projects = [
      createMockProject({
        name: "my-project",
        path: "/Users/jack/.claude/projects/-Users-jack-client-my-project",
        actual_path: "/Users/jack/client/my-project",
        session_count: 5,
        message_count: 100,
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups[0].projects[0].session_count).toBe(5);
    expect(result.groups[0].projects[0].message_count).toBe(100);
  });

  it("should handle deeply nested directories", () => {
    const projects = [
      createMockProject({
        name: "deep-project",
        path: "/path/d",
        actual_path: "/Users/jack/code/work/clients/acme/apps/deep-project",
      }),
    ];

    const result = groupProjectsByDirectory(projects);

    expect(result.groups[0].name).toBe("apps");
    expect(result.groups[0].path).toBe("/Users/jack/code/work/clients/acme/apps");
    expect(result.groups[0].displayPath).toBe("~/code/work/clients/acme/apps");
  });
});

describe("detectWorktreeGroupsHybrid", () => {
  it("should group projects with git_info", () => {
    const mainRepo = createMockProject({
      name: "gitproject",
      path: "/Users/jack/.claude/projects/-Users-jack-gitproject",
      actual_path: "/Users/jack/gitproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const linkedWorktree = createMockProject({
      name: "gitproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-gitproject",
      actual_path: "/tmp/feature/gitproject",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/gitproject",
    };

    const result = detectWorktreeGroupsHybrid([mainRepo, linkedWorktree]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parent.git_info?.worktree_type).toBe("main");
    expect(result.groups[0].children).toHaveLength(1);
  });

  it("should treat projects without git_info as ungrouped", () => {
    const mainRepo = createMockProject({
      name: "gitproject",
      path: "/Users/jack/.claude/projects/-Users-jack-gitproject",
      actual_path: "/Users/jack/gitproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const linkedWorktree = createMockProject({
      name: "gitproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-gitproject",
      actual_path: "/tmp/feature/gitproject",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/gitproject",
    };

    // Projects without git_info should be ungrouped
    const noGitParent = createMockProject({
      name: "legacyproject",
      path: "/Users/jack/.claude/projects/-Users-jack-legacyproject",
      actual_path: "/Users/jack/legacyproject",
    });

    const noGitWorktree = createMockProject({
      name: "legacyproject",
      path: "/Users/jack/.claude/projects/-tmp-branch-legacyproject",
      actual_path: "/tmp/branch/legacyproject",
    });

    const result = detectWorktreeGroupsHybrid([
      mainRepo,
      linkedWorktree,
      noGitParent,
      noGitWorktree,
    ]);

    // Only git-based group should be created
    expect(result.groups).toHaveLength(1);
    // Projects without git_info should be ungrouped
    expect(result.ungrouped).toHaveLength(2);
  });

  it("should use git_info for grouping", () => {
    const mainRepo = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-Users-jack-myproject",
      actual_path: "/Users/jack/myproject",
    });
    mainRepo.git_info = { worktree_type: "main" };

    const linkedWorktree = createMockProject({
      name: "myproject",
      path: "/Users/jack/.claude/projects/-tmp-feature-myproject",
      actual_path: "/tmp/feature/myproject",
    });
    linkedWorktree.git_info = {
      worktree_type: "linked",
      main_project_path: "/Users/jack/myproject",
    };

    const result = detectWorktreeGroupsHybrid([mainRepo, linkedWorktree]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parent.git_info?.worktree_type).toBe("main");
  });

  it("should not group projects without git_info", () => {
    const parent = createMockProject({
      name: "noinfo",
      path: "/Users/jack/.claude/projects/-Users-jack-noinfo",
      actual_path: "/Users/jack/noinfo",
    });

    const worktree = createMockProject({
      name: "noinfo",
      path: "/Users/jack/.claude/projects/-tmp-feature-noinfo",
      actual_path: "/tmp/feature/noinfo",
    });

    const result = detectWorktreeGroupsHybrid([parent, worktree]);

    // Without git_info, no grouping should happen
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });
});
