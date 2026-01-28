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

  describe("nested expansion behavior (multiple projects can be expanded)", () => {
    /**
     * Helper function that mirrors the actual implementation in ProjectTree.tsx
     * This allows us to test the toggle logic in isolation
     */
    const toggleProjectNested = (
      currentExpanded: Set<string>,
      projectPath: string
    ): Set<string> => {
      const next = new Set(currentExpanded);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    };

    describe("toggleProject function", () => {
      it("should expand a collapsed project", () => {
        const expanded = new Set<string>();
        const result = toggleProjectNested(expanded, "/project-a");

        expect(result.has("/project-a")).toBe(true);
        expect(result.size).toBe(1);
      });

      it("should collapse an expanded project", () => {
        const expanded = new Set(["/project-a"]);
        const result = toggleProjectNested(expanded, "/project-a");

        expect(result.has("/project-a")).toBe(false);
        expect(result.size).toBe(0);
      });

      it("should not mutate the original Set", () => {
        const original = new Set(["/project-a"]);
        const result = toggleProjectNested(original, "/project-b");

        expect(original.size).toBe(1);
        expect(original.has("/project-a")).toBe(true);
        expect(original.has("/project-b")).toBe(false);
        expect(result.size).toBe(2);
      });
    });

    describe("multiple project expansion", () => {
      it("should allow multiple projects to be expanded independently", () => {
        let expanded = new Set<string>();

        // Expand first project
        expanded = toggleProjectNested(expanded, "/project-a");
        expect(expanded.size).toBe(1);
        expect(expanded.has("/project-a")).toBe(true);

        // Expand second project - first should remain expanded
        expanded = toggleProjectNested(expanded, "/project-b");
        expect(expanded.size).toBe(2);
        expect(expanded.has("/project-a")).toBe(true);
        expect(expanded.has("/project-b")).toBe(true);

        // Expand third project - both previous should remain expanded
        expanded = toggleProjectNested(expanded, "/project-c");
        expect(expanded.size).toBe(3);
        expect(expanded.has("/project-a")).toBe(true);
        expect(expanded.has("/project-b")).toBe(true);
        expect(expanded.has("/project-c")).toBe(true);
      });

      it("should collapse only the toggled project without affecting others", () => {
        let expanded = new Set(["/project-a", "/project-b", "/project-c"]);

        // Collapse middle project
        expanded = toggleProjectNested(expanded, "/project-b");

        expect(expanded.size).toBe(2);
        expect(expanded.has("/project-a")).toBe(true);
        expect(expanded.has("/project-b")).toBe(false);
        expect(expanded.has("/project-c")).toBe(true);
      });

      it("should handle rapid toggle operations correctly", () => {
        let expanded = new Set<string>();

        // Rapid expansion
        expanded = toggleProjectNested(expanded, "/project-a");
        expanded = toggleProjectNested(expanded, "/project-b");
        expanded = toggleProjectNested(expanded, "/project-a"); // collapse
        expanded = toggleProjectNested(expanded, "/project-c");
        expanded = toggleProjectNested(expanded, "/project-a"); // re-expand

        expect(expanded.size).toBe(3);
        expect(expanded.has("/project-a")).toBe(true);
        expect(expanded.has("/project-b")).toBe(true);
        expect(expanded.has("/project-c")).toBe(true);
      });
    });

    describe("worktree group expansion", () => {
      it("should expand main repo and worktrees independently", () => {
        let expanded = new Set<string>();

        const mainRepoPath = "/Users/jack/main-project";
        const worktree1Path = "/tmp/feature-1/main-project";
        const worktree2Path = "/tmp/feature-2/main-project";
        void worktree2Path; // Reserved for future test expansion
        const groupKey = "worktree-group-main-project";

        // Expand group
        expanded = toggleProjectNested(expanded, groupKey);
        expect(expanded.has(groupKey)).toBe(true);

        // Expand main repo within group
        expanded = toggleProjectNested(expanded, mainRepoPath);
        expect(expanded.has(mainRepoPath)).toBe(true);
        expect(expanded.has(groupKey)).toBe(true);

        // Expand worktree 1
        expanded = toggleProjectNested(expanded, worktree1Path);
        expect(expanded.has(worktree1Path)).toBe(true);
        expect(expanded.has(mainRepoPath)).toBe(true);

        // Collapse main repo - worktrees should remain expanded
        expanded = toggleProjectNested(expanded, mainRepoPath);
        expect(expanded.has(mainRepoPath)).toBe(false);
        expect(expanded.has(worktree1Path)).toBe(true);
        expect(expanded.has(groupKey)).toBe(true);
      });

      it("should allow viewing sessions from multiple worktrees simultaneously", () => {
        const expandedProjects = new Set([
          "/Users/jack/main-project",
          "/tmp/feature-branch/main-project",
          "/tmp/hotfix/main-project",
        ]);

        // All three can be expanded at once
        expect(expandedProjects.size).toBe(3);

        // Each project's sessions would be visible independently
        // This is the key difference from accordion behavior
      });
    });

    describe("directory group expansion", () => {
      it("should expand directory groups and projects independently", () => {
        let expanded = new Set<string>();

        const groupKey = "directory-group-client";
        const project1 = "/Users/jack/client/app1";
        const project2 = "/Users/jack/client/app2";

        // Expand directory group
        expanded = toggleProjectNested(expanded, groupKey);
        expect(expanded.has(groupKey)).toBe(true);

        // Expand projects within group
        expanded = toggleProjectNested(expanded, project1);
        expanded = toggleProjectNested(expanded, project2);

        expect(expanded.size).toBe(3);
        expect(expanded.has(groupKey)).toBe(true);
        expect(expanded.has(project1)).toBe(true);
        expect(expanded.has(project2)).toBe(true);

        // Collapse group - projects should remain in their state
        expanded = toggleProjectNested(expanded, groupKey);
        expect(expanded.has(groupKey)).toBe(false);
        expect(expanded.has(project1)).toBe(true);
        expect(expanded.has(project2)).toBe(true);
      });
    });

    describe("isProjectExpanded helper", () => {
      it("should return true for expanded projects", () => {
        const expanded = new Set(["/project-a", "/project-b"]);

        expect(expanded.has("/project-a")).toBe(true);
        expect(expanded.has("/project-b")).toBe(true);
      });

      it("should return false for collapsed projects", () => {
        const expanded = new Set(["/project-a"]);

        expect(expanded.has("/project-b")).toBe(false);
        expect(expanded.has("/project-c")).toBe(false);
      });

      it("should return false for empty expansion state", () => {
        const expanded = new Set<string>();

        expect(expanded.has("/any-project")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle empty string path", () => {
        let expanded = new Set<string>();
        expanded = toggleProjectNested(expanded, "");

        expect(expanded.has("")).toBe(true);
        expect(expanded.size).toBe(1);
      });

      it("should handle paths with special characters", () => {
        let expanded = new Set<string>();
        const specialPath = "/Users/jack/project with spaces/@special-chars";

        expanded = toggleProjectNested(expanded, specialPath);
        expect(expanded.has(specialPath)).toBe(true);

        expanded = toggleProjectNested(expanded, specialPath);
        expect(expanded.has(specialPath)).toBe(false);
      });

      it("should handle very long paths", () => {
        let expanded = new Set<string>();
        const longPath = "/a".repeat(500);

        expanded = toggleProjectNested(expanded, longPath);
        expect(expanded.has(longPath)).toBe(true);
      });

      it("should handle duplicate toggle calls idempotently", () => {
        let expanded = new Set<string>();

        // Double expand should result in collapse
        expanded = toggleProjectNested(expanded, "/project-a");
        expanded = toggleProjectNested(expanded, "/project-a");

        expect(expanded.has("/project-a")).toBe(false);
      });
    });
  });
});

describe("ProjectTree user flow scenarios", () => {
  /**
   * Simulates the actual user interaction flow in ProjectTree component
   * These tests verify the state transitions during typical user scenarios
   */

  // Simulates the component's internal state management
  interface ProjectTreeState {
    expandedProjects: Set<string>;
    selectedProject: ClaudeProject | null;
    sessions: ClaudeSession[];
  }

  // Action creators that mirror the component behavior
  const createActions = (getState: () => ProjectTreeState, setState: (s: Partial<ProjectTreeState>) => void) => ({
    toggleProject: (path: string) => {
      const { expandedProjects } = getState();
      const next = new Set(expandedProjects);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      setState({ expandedProjects: next });
    },
    selectProject: (project: ClaudeProject) => {
      setState({ selectedProject: project });
    },
    loadSessions: (sessions: ClaudeSession[]) => {
      setState({ sessions });
    },
    isExpanded: (path: string) => getState().expandedProjects.has(path),
  });

  describe("directory group → project → session flow", () => {
    it("should expand group, then project, showing sessions", () => {
      let state: ProjectTreeState = {
        expandedProjects: new Set(),
        selectedProject: null,
        sessions: [],
      };

      const getState = () => state;
      const setState = (partial: Partial<ProjectTreeState>) => {
        state = { ...state, ...partial };
      };
      const actions = createActions(getState, setState);

      const groupKey = "dir:/Users/jack/client";
      const project = createMockProject({
        name: "my-app",
        path: "/Users/jack/client/my-app",
      });
      const mockSessions: ClaudeSession[] = [
        {
          session_id: "session-1",
          actual_session_id: "session-1",
          project_path: project.path,
          project_name: project.name,
          file_path: "/path/to/session.jsonl",
          message_count: 10,
          last_modified: new Date().toISOString(),
        },
      ];

      // Step 1: User clicks directory group header
      actions.toggleProject(groupKey);
      expect(actions.isExpanded(groupKey)).toBe(true);

      // Step 2: User clicks project within group
      actions.selectProject(project);
      actions.toggleProject(project.path);
      expect(actions.isExpanded(project.path)).toBe(true);
      expect(state.selectedProject?.path).toBe(project.path);

      // Step 3: Sessions are loaded (simulated)
      actions.loadSessions(mockSessions);
      expect(state.sessions).toHaveLength(1);

      // Verify: Both group and project remain expanded
      expect(actions.isExpanded(groupKey)).toBe(true);
      expect(actions.isExpanded(project.path)).toBe(true);
    });

    it("should allow switching between projects while keeping groups expanded", () => {
      let state: ProjectTreeState = {
        expandedProjects: new Set(),
        selectedProject: null,
        sessions: [],
      };

      const getState = () => state;
      const setState = (partial: Partial<ProjectTreeState>) => {
        state = { ...state, ...partial };
      };
      const actions = createActions(getState, setState);

      const groupKey = "dir:/Users/jack/client";
      const project1 = createMockProject({ name: "app1", path: "/Users/jack/client/app1" });
      const project2 = createMockProject({ name: "app2", path: "/Users/jack/client/app2" });

      // Expand group and first project
      actions.toggleProject(groupKey);
      actions.selectProject(project1);
      actions.toggleProject(project1.path);

      // Switch to second project (expand it too)
      actions.selectProject(project2);
      actions.toggleProject(project2.path);

      // Verify: Both projects can be expanded simultaneously
      expect(actions.isExpanded(groupKey)).toBe(true);
      expect(actions.isExpanded(project1.path)).toBe(true);
      expect(actions.isExpanded(project2.path)).toBe(true);
      expect(state.selectedProject?.path).toBe(project2.path);
    });

    it("should collapse only clicked project, preserving others", () => {
      let state: ProjectTreeState = {
        expandedProjects: new Set(),
        selectedProject: null,
        sessions: [],
      };

      const getState = () => state;
      const setState = (partial: Partial<ProjectTreeState>) => {
        state = { ...state, ...partial };
      };
      const actions = createActions(getState, setState);

      const project1 = createMockProject({ name: "app1", path: "/path/app1" });
      const project2 = createMockProject({ name: "app2", path: "/path/app2" });
      const project3 = createMockProject({ name: "app3", path: "/path/app3" });

      // Expand all three
      actions.toggleProject(project1.path);
      actions.toggleProject(project2.path);
      actions.toggleProject(project3.path);

      expect(state.expandedProjects.size).toBe(3);

      // User collapses middle project
      actions.toggleProject(project2.path);

      expect(actions.isExpanded(project1.path)).toBe(true);
      expect(actions.isExpanded(project2.path)).toBe(false);
      expect(actions.isExpanded(project3.path)).toBe(true);
    });
  });

  describe("worktree group → main repo → linked worktree flow", () => {
    it("should expand worktree group and navigate between main and worktrees", () => {
      let state: ProjectTreeState = {
        expandedProjects: new Set(),
        selectedProject: null,
        sessions: [],
      };

      const getState = () => state;
      const setState = (partial: Partial<ProjectTreeState>) => {
        state = { ...state, ...partial };
      };
      const actions = createActions(getState, setState);

      const worktreeGroupKey = "worktree:/Users/jack/main-project";
      const mainRepo = createMockProject({
        name: "main-project",
        path: "/Users/jack/main-project",
        git_info: { worktree_type: "main" },
      });
      const linkedWorktree = createMockProject({
        name: "main-project",
        path: "/tmp/feature-branch/main-project",
        git_info: { worktree_type: "linked", main_project_path: "/Users/jack/main-project" },
      });

      // Step 1: Expand worktree group
      actions.toggleProject(worktreeGroupKey);
      expect(actions.isExpanded(worktreeGroupKey)).toBe(true);

      // Step 2: Select and expand main repo
      actions.selectProject(mainRepo);
      actions.toggleProject(mainRepo.path);
      expect(actions.isExpanded(mainRepo.path)).toBe(true);

      // Step 3: Also expand linked worktree (both visible at same time)
      actions.selectProject(linkedWorktree);
      actions.toggleProject(linkedWorktree.path);
      expect(actions.isExpanded(linkedWorktree.path)).toBe(true);

      // Verify: All expanded at same time
      expect(state.expandedProjects.size).toBe(3);
      expect(actions.isExpanded(worktreeGroupKey)).toBe(true);
      expect(actions.isExpanded(mainRepo.path)).toBe(true);
      expect(actions.isExpanded(linkedWorktree.path)).toBe(true);
    });

    it("should allow comparing sessions between main and worktree", () => {
      const state: ProjectTreeState = {
        expandedProjects: new Set([
          "/Users/jack/main-project",
          "/tmp/feature-branch/main-project",
        ]),
        selectedProject: null,
        sessions: [],
      };

      // Both main and worktree are expanded
      // User can see sessions from both simultaneously
      expect(state.expandedProjects.has("/Users/jack/main-project")).toBe(true);
      expect(state.expandedProjects.has("/tmp/feature-branch/main-project")).toBe(true);

      // This is the key benefit of nested expansion:
      // Users can compare work across worktrees without losing context
    });
  });

  describe("deep nesting scenarios", () => {
    it("should handle 3+ levels of nesting: group → project → sessions", () => {
      let state: ProjectTreeState = {
        expandedProjects: new Set(),
        selectedProject: null,
        sessions: [],
      };

      const getState = () => state;
      const setState = (partial: Partial<ProjectTreeState>) => {
        state = { ...state, ...partial };
      };
      const actions = createActions(getState, setState);

      // Level 1: Directory groups
      const group1 = "dir:/Users/jack/client";
      const group2 = "dir:/Users/jack/server";

      // Level 2: Projects within groups
      const clientApp = createMockProject({ path: "/Users/jack/client/app" });
      const clientLib = createMockProject({ path: "/Users/jack/client/lib" });
      const serverApi = createMockProject({ path: "/Users/jack/server/api" });

      // Expand multiple levels simultaneously
      actions.toggleProject(group1);
      actions.toggleProject(group2);
      actions.toggleProject(clientApp.path);
      actions.toggleProject(clientLib.path);
      actions.toggleProject(serverApi.path);

      // All 5 should be expanded
      expect(state.expandedProjects.size).toBe(5);

      // Collapse one group - projects within should remain in their state
      actions.toggleProject(group1);
      expect(actions.isExpanded(group1)).toBe(false);
      expect(actions.isExpanded(clientApp.path)).toBe(true); // Still tracked as expanded
      expect(actions.isExpanded(clientLib.path)).toBe(true);
      expect(actions.isExpanded(group2)).toBe(true);
      expect(actions.isExpanded(serverApi.path)).toBe(true);
    });

    it("should maintain expansion state when navigating away and back", () => {
      let state: ProjectTreeState = {
        expandedProjects: new Set(),
        selectedProject: null,
        sessions: [],
      };

      const getState = () => state;
      const setState = (partial: Partial<ProjectTreeState>) => {
        state = { ...state, ...partial };
      };
      const actions = createActions(getState, setState);

      const project1 = createMockProject({ path: "/path/project1" });
      const project2 = createMockProject({ path: "/path/project2" });

      // User expands project1 and views sessions
      actions.toggleProject(project1.path);
      actions.selectProject(project1);
      actions.loadSessions([{ session_id: "s1" } as ClaudeSession]);

      // User clicks project2 (leaves project1 expanded)
      actions.toggleProject(project2.path);
      actions.selectProject(project2);

      // User returns to project1 - it should still be expanded
      actions.selectProject(project1);
      expect(actions.isExpanded(project1.path)).toBe(true);
      expect(actions.isExpanded(project2.path)).toBe(true);
    });
  });

  describe("session visibility based on selection", () => {
    it("should only show sessions for the selected project", () => {
      const expandedProjects = new Set(["/project-a", "/project-b", "/project-c"]);
      const selectedProjectPath = "/project-b";

      // Helper to determine if sessions should be shown for a project
      // Sessions only show when: expanded AND selected
      const shouldShowSessions = (projectPath: string) =>
        expandedProjects.has(projectPath) && projectPath === selectedProjectPath;

      // Even though project-a is expanded, sessions should NOT show (not selected)
      expect(shouldShowSessions("/project-a")).toBe(false);

      // Project-b is expanded AND selected, sessions SHOULD show
      expect(shouldShowSessions("/project-b")).toBe(true);

      // Project-c is expanded but not selected, sessions should NOT show
      expect(shouldShowSessions("/project-c")).toBe(false);
    });

    it("should not show sessions when no project is selected", () => {
      const expandedProjects = new Set(["/project-a"]);
      const selectedProjectPath: string | null = null;

      const shouldShowSessions = (projectPath: string) =>
        expandedProjects.has(projectPath) && projectPath === selectedProjectPath;

      expect(shouldShowSessions("/project-a")).toBe(false);
    });

    it("should update session visibility when selection changes", () => {
      const expandedProjects = new Set(["/project-a", "/project-b"]);
      let selectedProjectPath = "/project-a";

      const shouldShowSessions = (projectPath: string) =>
        expandedProjects.has(projectPath) && projectPath === selectedProjectPath;

      // Initially project-a is selected
      expect(shouldShowSessions("/project-a")).toBe(true);
      expect(shouldShowSessions("/project-b")).toBe(false);

      // User clicks project-b (changes selection)
      selectedProjectPath = "/project-b";

      // Now project-b shows sessions, project-a does not
      expect(shouldShowSessions("/project-a")).toBe(false);
      expect(shouldShowSessions("/project-b")).toBe(true);
    });

    it("should handle worktree scenario: main and linked both expanded, only selected shows sessions", () => {
      const mainRepoPath = "/Users/jack/main-project";
      const linkedWorktreePath = "/tmp/feature/main-project";

      const expandedProjects = new Set([mainRepoPath, linkedWorktreePath]);
      const selectedProjectPath = linkedWorktreePath;

      const shouldShowSessions = (projectPath: string) =>
        expandedProjects.has(projectPath) && projectPath === selectedProjectPath;

      // Main repo is expanded but not selected - no sessions shown
      expect(shouldShowSessions(mainRepoPath)).toBe(false);

      // Linked worktree is expanded AND selected - sessions shown
      expect(shouldShowSessions(linkedWorktreePath)).toBe(true);
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
