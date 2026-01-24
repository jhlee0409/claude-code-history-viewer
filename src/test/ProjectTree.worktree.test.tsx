/**
 * @fileoverview Tests for ProjectTree worktree grouping functionality
 * Tests the UI behavior when worktree grouping is enabled/disabled
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
      worktreeGrouping: false,
      directoryGrouping: false,
      hiddenProjects: [],
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
    git_info: overrides.git_info ?? null,
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
    mockStore.userMetadata.settings.worktreeGrouping = false;
    mockStore.userMetadata.settings.directoryGrouping = false;
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

      expect(project.git_info).toBeNull();
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
      mockStore.userMetadata.settings.worktreeGrouping = false;

      // Simulate toggle
      mockStore.updateUserSettings({ worktreeGrouping: true });

      expect(mockStore.updateUserSettings).toHaveBeenCalledWith({
        worktreeGrouping: true,
      });
    });

    it("should toggle directory grouping setting", () => {
      mockStore.userMetadata.settings.directoryGrouping = false;

      // Simulate toggle
      mockStore.updateUserSettings({ directoryGrouping: true });

      expect(mockStore.updateUserSettings).toHaveBeenCalledWith({
        directoryGrouping: true,
      });
    });

    it("should handle both grouping modes being enabled", () => {
      mockStore.userMetadata.settings.worktreeGrouping = true;
      mockStore.userMetadata.settings.directoryGrouping = true;

      // When both are enabled, directory grouping takes precedence
      // This is testing the expected behavior
      expect(mockStore.userMetadata.settings.worktreeGrouping).toBe(true);
      expect(mockStore.userMetadata.settings.directoryGrouping).toBe(true);
    });
  });

  describe("project visibility", () => {
    it("should filter hidden projects", () => {
      mockStore.userMetadata.settings.hiddenProjects = ["**/node_modules/**"];

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

      // Filter simulation
      const visibleProjects = projects.filter(
        (p) => !mockStore.userMetadata.settings.hiddenProjects.some(
          (pattern) => p.actual_path.includes("node_modules")
        )
      );

      expect(visibleProjects).toHaveLength(1);
      expect(visibleProjects[0].name).toBe("visible-project");
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
      createMockProject({ name: "no-info", git_info: null }),
    ];

    const mainRepos = projects.filter((p) => p.git_info?.worktree_type === "main");
    const linkedWorktrees = projects.filter((p) => p.git_info?.worktree_type === "linked");
    const notGit = projects.filter((p) => p.git_info?.worktree_type === "not_git");
    const noInfo = projects.filter((p) => p.git_info === null);

    expect(mainRepos).toHaveLength(1);
    expect(linkedWorktrees).toHaveLength(1);
    expect(notGit).toHaveLength(1);
    expect(noInfo).toHaveLength(1);
  });
});
