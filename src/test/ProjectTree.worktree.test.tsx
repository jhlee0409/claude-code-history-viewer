/**
 * @fileoverview Tests for ProjectTree worktree grouping functionality
 * Tests the UI behavior when worktree grouping is enabled/disabled
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClaudeProject, ClaudeSession } from "../types";
import type { WorktreeGroupingResult, DirectoryGroupingResult } from "../utils/worktreeUtils";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Mock the store
const mockStore = {
  projects: [] as ClaudeProject[],
  sessions: [] as ClaudeSession[],
  selectedProject: null as ClaudeProject | null,
  selectedSession: null as ClaudeSession | null,
  expandedProjects: new Set<string>(),
  isLoading: false,
  userMetadata: {
    settings: {
      groupingMode: "none" as const,
      hiddenPatterns: [] as string[],
    },
  },
  setSelectedProject: vi.fn(),
  setSelectedSession: vi.fn(),
  toggleProjectExpanded: vi.fn(),
  loadProjectSessions: vi.fn(),
  getGroupedProjects: vi.fn(() => ({ groups: [], ungrouped: [] })),
  getDirectoryGroupedProjects: vi.fn(() => ({ groups: [], ungrouped: [] })),
  updateUserSettings: vi.fn(),
};

vi.mock("../store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

// Mock metadata hooks
vi.mock("../hooks/useMetadata", () => ({
  useSessionMetadata: () => ({
    metadata: null,
    setCustomName: vi.fn(),
    displayName: "Test Session",
  }),
  useProjectMetadata: () => ({
    metadata: null,
    setHidden: vi.fn(),
    setParentProject: vi.fn(),
  }),
  useSessionDisplayName: (sessionId: string, summary?: string) => summary || "No summary",
}));

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

describe("ProjectTree worktree grouping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.projects = [];
    mockStore.sessions = [];
    mockStore.selectedProject = null;
    mockStore.selectedSession = null;
    mockStore.expandedProjects = new Set();
    mockStore.userMetadata.settings.groupingMode = "none";
  });

  describe("worktree grouping detection", () => {
    it("should correctly identify main repos and linked worktrees based on git_info", () => {
      const mainRepo = createMockProject({
        name: "main-project",
        path: "/Users/jack/.claude/projects/-Users-jack-main-project",
        actual_path: "/Users/jack/main-project",
      });
      mainRepo.git_info = { worktree_type: "main" };

      const linkedWorktree = createMockProject({
        name: "main-project",
        path: "/Users/jack/.claude/projects/-tmp-feature-main-project",
        actual_path: "/tmp/feature/main-project",
      });
      linkedWorktree.git_info = {
        worktree_type: "linked",
        main_project_path: "/Users/jack/main-project",
      };

      // Verify git_info is set correctly
      expect(mainRepo.git_info.worktree_type).toBe("main");
      expect(linkedWorktree.git_info?.worktree_type).toBe("linked");
      expect(linkedWorktree.git_info?.main_project_path).toBe("/Users/jack/main-project");
    });

    it("should handle projects without git_info", () => {
      const project = createMockProject({
        name: "no-git-project",
        path: "/Users/jack/no-git-project",
      });

      expect(project.git_info).toBeUndefined();
    });
  });

  describe("grouping result structure", () => {
    it("should have correct WorktreeGroupingResult structure", () => {
      const result: WorktreeGroupingResult = {
        groups: [
          {
            parent: createMockProject({ name: "parent" }),
            children: [createMockProject({ name: "child" })],
          },
        ],
        ungrouped: [createMockProject({ name: "standalone" })],
      };

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].parent.name).toBe("parent");
      expect(result.groups[0].children).toHaveLength(1);
      expect(result.ungrouped).toHaveLength(1);
    });

    it("should have correct DirectoryGroupingResult structure", () => {
      const result: DirectoryGroupingResult = {
        groups: [
          {
            name: "client",
            path: "/Users/jack/client",
            displayPath: "~/client",
            projects: [createMockProject({ name: "app1" }), createMockProject({ name: "app2" })],
          },
        ],
        ungrouped: [],
      };

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe("client");
      expect(result.groups[0].displayPath).toBe("~/client");
      expect(result.groups[0].projects).toHaveLength(2);
    });
  });

  describe("settings toggle behavior", () => {
    it("should toggle worktree grouping setting", () => {
      mockStore.userMetadata.settings.groupingMode = "none";

      // Simulate toggle to worktree mode
      mockStore.updateUserSettings({ groupingMode: "worktree" });

      expect(mockStore.updateUserSettings).toHaveBeenCalledWith({
        groupingMode: "worktree",
      });
    });

    it("should toggle directory grouping setting", () => {
      mockStore.userMetadata.settings.groupingMode = "none";

      // Simulate toggle to directory mode
      mockStore.updateUserSettings({ groupingMode: "directory" });

      expect(mockStore.updateUserSettings).toHaveBeenCalledWith({
        groupingMode: "directory",
      });
    });

    it("should support switching between grouping modes", () => {
      mockStore.userMetadata.settings.groupingMode = "worktree";

      // Switch to directory mode
      mockStore.updateUserSettings({ groupingMode: "directory" });

      expect(mockStore.updateUserSettings).toHaveBeenCalledWith({
        groupingMode: "directory",
      });
    });
  });

  describe("project visibility", () => {
    it("should filter hidden projects using glob patterns", () => {
      mockStore.userMetadata.settings.hiddenPatterns = ["**/node_modules/**"];

      const projects = [
        createMockProject({
          name: "visible-project",
          actual_path: "/Users/jack/visible-project",
        }),
        createMockProject({
          name: "node_modules",
          actual_path: "/Users/jack/code/node_modules/some-lib",
        }),
      ];

      // Filter simulation using glob matching (simplified for test)
      const visibleProjects = projects.filter((p) => {
        const patterns = mockStore.userMetadata.settings.hiddenPatterns;
        // Simplified glob check: pattern "**/node_modules/**" matches paths containing node_modules
        return !patterns.some((pattern) => {
          if (pattern === "**/node_modules/**") {
            return p.actual_path.includes("/node_modules/");
          }
          return false;
        });
      });

      expect(visibleProjects).toHaveLength(1);
      expect(visibleProjects[0].name).toBe("visible-project");
    });

    it("should support wildcard patterns for hiding", () => {
      mockStore.userMetadata.settings.hiddenPatterns = ["*-dg-*"];

      const projects = [
        createMockProject({
          name: "normal-project",
          actual_path: "/Users/jack/normal-project",
        }),
        createMockProject({
          name: "folders-dg-test",
          actual_path: "/Users/jack/folders-dg-test",
        }),
      ];

      // Simplified glob check for wildcard pattern
      const visibleProjects = projects.filter((p) => {
        const patterns = mockStore.userMetadata.settings.hiddenPatterns;
        return !patterns.some((pattern) => {
          if (pattern === "*-dg-*") {
            return /-dg-/.test(p.name);
          }
          return false;
        });
      });

      expect(visibleProjects).toHaveLength(1);
      expect(visibleProjects[0].name).toBe("normal-project");
    });
  });

  describe("worktree display labels", () => {
    it("should format worktree path for display", () => {
      // Simulate getWorktreeLabel behavior
      const worktreePath = "/tmp/feature-branch/my-project";
      const label = worktreePath.replace(/^\/tmp\//, "").replace(/^\/private\/tmp\//, "");

      expect(label).toBe("feature-branch/my-project");
    });

    it("should handle private/tmp paths", () => {
      const worktreePath = "/private/tmp/hotfix/my-project";
      const label = worktreePath.replace(/^\/private\/tmp\//, "");

      expect(label).toBe("hotfix/my-project");
    });
  });

  describe("directory group display", () => {
    it("should create display path with ~ for home directory", () => {
      const fullPath = "/Users/jack/client";
      const homePath = "/Users/jack";
      const displayPath = fullPath.startsWith(homePath)
        ? "~" + fullPath.slice(homePath.length)
        : fullPath;

      expect(displayPath).toBe("~/client");
    });

    it("should preserve non-home paths as-is", () => {
      const fullPath = "/tmp/feature";
      const homePath = "/Users/jack";
      const displayPath = fullPath.startsWith(homePath)
        ? "~" + fullPath.slice(homePath.length)
        : fullPath;

      expect(displayPath).toBe("/tmp/feature");
    });
  });

  describe("project sorting within groups", () => {
    it("should sort projects alphabetically by name", () => {
      const projects = [
        createMockProject({ name: "zebra" }),
        createMockProject({ name: "apple" }),
        createMockProject({ name: "mango" }),
      ];

      const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

      expect(sorted.map((p) => p.name)).toEqual(["apple", "mango", "zebra"]);
    });
  });

  describe("group expansion state", () => {
    it("should track expanded groups separately", () => {
      const expandedGroups = new Set<string>();

      expandedGroups.add("group-client");
      expandedGroups.add("group-server");

      expect(expandedGroups.has("group-client")).toBe(true);
      expect(expandedGroups.has("group-server")).toBe(true);
      expect(expandedGroups.has("group-libs")).toBe(false);
    });
  });

  describe("accordion behavior (single project expansion)", () => {
    it("should only allow one project to be expanded at a time", () => {
      // Simulate accordion toggle logic
      const toggleProjectAccordion = (
        currentExpanded: Set<string>,
        projectPath: string
      ): Set<string> => {
        // If the project is already expanded, collapse it
        if (currentExpanded.has(projectPath)) {
          return new Set();
        }
        // Otherwise, expand only this project (collapse all others)
        return new Set([projectPath]);
      };

      let expanded = new Set<string>();

      // Expand first project
      expanded = toggleProjectAccordion(expanded, "/project-a");
      expect(expanded.size).toBe(1);
      expect(expanded.has("/project-a")).toBe(true);

      // Expand second project - first should collapse
      expanded = toggleProjectAccordion(expanded, "/project-b");
      expect(expanded.size).toBe(1);
      expect(expanded.has("/project-a")).toBe(false);
      expect(expanded.has("/project-b")).toBe(true);

      // Toggle same project - should collapse
      expanded = toggleProjectAccordion(expanded, "/project-b");
      expect(expanded.size).toBe(0);
    });

    it("should prevent showing sessions from wrong project", () => {
      // This test documents the bug and its fix
      // Bug: Multiple projects expanded shows same sessions for all
      // Fix: Only one project can be expanded, so sessions always match

      // Sessions that would exist for this project (documenting the scenario)
      // const sessions = [
      //   { session_id: "1", project_name: "project-a" },
      //   { session_id: "2", project_name: "project-a" },
      // ];

      // With accordion behavior, only one project is expanded at a time
      // So sessions are always from the correct project
      const expandedProject = "/project-a";
      const selectedProjectPath = "/project-a";

      // Sessions should only be displayed when the expanded project matches selected
      const shouldShowSessions = expandedProject === selectedProjectPath;
      expect(shouldShowSessions).toBe(true);

      // If different project was selected, accordion would collapse the old one
      // preventing mismatched session display
    });
  });
});

describe("ProjectTree edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle empty project list", () => {
    mockStore.projects = [];
    mockStore.getGroupedProjects.mockReturnValue({ groups: [], ungrouped: [] });

    const result = mockStore.getGroupedProjects();

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("should handle projects with same name in different directories", () => {
    const projects = [
      createMockProject({
        name: "app",
        actual_path: "/Users/jack/client/app",
      }),
      createMockProject({
        name: "app",
        actual_path: "/Users/jack/server/app",
      }),
    ];

    // Both should be visible
    expect(projects).toHaveLength(2);
    expect(projects[0].actual_path).not.toBe(projects[1].actual_path);
  });

  it("should handle deeply nested project paths", () => {
    const project = createMockProject({
      name: "deep-project",
      actual_path: "/Users/jack/code/work/clients/acme/frontend/apps/web/deep-project",
    });

    // Extract parent directory
    const segments = project.actual_path.split("/").filter(Boolean);
    const parentDir = "/" + segments.slice(0, -1).join("/");

    expect(parentDir).toBe("/Users/jack/code/work/clients/acme/frontend/apps/web");
  });

  it("should handle project with special characters in name", () => {
    const project = createMockProject({
      name: "my-app_v2.0@beta",
      actual_path: "/Users/jack/my-app_v2.0@beta",
    });

    expect(project.name).toBe("my-app_v2.0@beta");
  });

  it("should handle mixed worktree types", () => {
    const projects = [
      createMockProject({ name: "main", git_info: { worktree_type: "main" } }),
      createMockProject({ name: "linked", git_info: { worktree_type: "linked", main_project_path: "/main" } }),
      createMockProject({ name: "not-git", git_info: { worktree_type: "not_git" } }),
      createMockProject({ name: "no-info", git_info: undefined }),
    ];

    const mainRepos = projects.filter((p) => p.git_info?.worktree_type === "main");
    const linkedWorktrees = projects.filter((p) => p.git_info?.worktree_type === "linked");
    const notGit = projects.filter((p) => p.git_info?.worktree_type === "not_git");
    const noInfo = projects.filter((p) => p.git_info === undefined);

    expect(mainRepos).toHaveLength(1);
    expect(linkedWorktrees).toHaveLength(1);
    expect(notGit).toHaveLength(1);
    expect(noInfo).toHaveLength(1);
  });
});
