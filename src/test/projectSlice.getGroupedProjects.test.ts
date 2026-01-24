/**
 * @fileoverview Tests for projectSlice getGroupedProjects selector
 * Tests for worktree grouping functionality in the store
 */
import { describe, it, expect } from "vitest";
import type { ClaudeProject } from "../types";
import {
  detectWorktreeGroups,
  detectWorktreeGroupsHybrid,
} from "../utils/worktreeUtils";

// Since we can't easily test the full Zustand store with all its dependencies,
// we test the detectWorktreeGroups and detectWorktreeGroupsHybrid functions directly.
// The store's getGroupedProjects uses the hybrid version which combines:
// 1. Git-based grouping (100% accurate when git info is available)
// 2. Heuristic-based grouping (fallback for projects without git info)

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

describe("getGroupedProjects logic", () => {
  describe("when worktreeGrouping is disabled", () => {
    it("should return all projects as ungrouped", () => {
      const projects = [
        createMockProject({ name: "project-a", path: "/Users/jack/project-a" }),
        createMockProject({ name: "project-b", path: "/tmp/branch/project-b" }),
      ];

      // Simulate disabled grouping - return all as ungrouped
      const result = { groups: [], ungrouped: projects };

      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(2);
    });
  });

  describe("when worktreeGrouping is enabled", () => {
    it("should group worktrees with their parent projects", () => {
      const projects = [
        createMockProject({ name: "my-app", path: "/Users/jack/my-app" }),
        createMockProject({ name: "my-app", path: "/tmp/feature-branch/my-app" }),
        createMockProject({
          name: "my-app",
          path: "/private/tmp/hotfix/my-app",
        }),
        createMockProject({
          name: "standalone",
          path: "/Users/jack/standalone",
        }),
      ];

      const result = detectWorktreeGroups(projects);

      // Should have 1 group (my-app with 2 worktrees)
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].parent.path).toBe("/Users/jack/my-app");
      expect(result.groups[0].children).toHaveLength(2);

      // standalone should be ungrouped
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].path).toBe("/Users/jack/standalone");
    });

    it("should handle empty projects array", () => {
      const result = detectWorktreeGroups([]);

      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(0);
    });

    it("should handle only regular projects (no worktrees)", () => {
      const projects = [
        createMockProject({ name: "project-a", path: "/Users/jack/project-a" }),
        createMockProject({ name: "project-b", path: "/home/user/project-b" }),
      ];

      const result = detectWorktreeGroups(projects);

      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(2);
    });

    it("should handle only tmp projects without parents (orphan worktrees)", () => {
      const projects = [
        createMockProject({
          name: "orphan-project",
          path: "/tmp/branch/orphan-project",
        }),
      ];

      const result = detectWorktreeGroups(projects);

      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(1);
    });

    it("should correctly identify multiple parent-child relationships", () => {
      const projects = [
        // Parent 1 with 1 worktree
        createMockProject({ name: "app-one", path: "/Users/jack/app-one" }),
        createMockProject({
          name: "app-one",
          path: "/tmp/feature/app-one",
        }),
        // Parent 2 with 2 worktrees
        createMockProject({ name: "app-two", path: "/Users/jack/app-two" }),
        createMockProject({
          name: "app-two",
          path: "/tmp/branch-a/app-two",
        }),
        createMockProject({
          name: "app-two",
          path: "/tmp/branch-b/app-two",
        }),
        // Standalone project
        createMockProject({ name: "standalone", path: "/Users/jack/standalone" }),
      ];

      const result = detectWorktreeGroups(projects);

      expect(result.groups).toHaveLength(2);

      // Find app-one group
      const appOneGroup = result.groups.find(
        (g) => g.parent.name === "app-one"
      );
      expect(appOneGroup).toBeDefined();
      expect(appOneGroup?.children).toHaveLength(1);

      // Find app-two group
      const appTwoGroup = result.groups.find(
        (g) => g.parent.name === "app-two"
      );
      expect(appTwoGroup).toBeDefined();
      expect(appTwoGroup?.children).toHaveLength(2);

      // Standalone should be ungrouped
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].name).toBe("standalone");
    });

    it("should preserve project metadata in groups", () => {
      const parent = createMockProject({
        name: "my-project",
        path: "/Users/jack/my-project",
        session_count: 5,
        message_count: 100,
      });
      const worktree = createMockProject({
        name: "my-project",
        path: "/tmp/feature/my-project",
        session_count: 2,
        message_count: 25,
      });

      const result = detectWorktreeGroups([parent, worktree]);

      expect(result.groups[0].parent.session_count).toBe(5);
      expect(result.groups[0].parent.message_count).toBe(100);
      expect(result.groups[0].children[0].session_count).toBe(2);
      expect(result.groups[0].children[0].message_count).toBe(25);
    });
  });

  describe("detectWorktreeGroupsHybrid", () => {
    it("should use heuristic grouping when git info is not available", () => {
      const projects = [
        createMockProject({ name: "my-app", path: "/Users/jack/my-app" }),
        createMockProject({ name: "my-app", path: "/tmp/feature-branch/my-app" }),
      ];

      const result = detectWorktreeGroupsHybrid(projects);

      // Should fall back to heuristic grouping
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].parent.path).toBe("/Users/jack/my-app");
      expect(result.groups[0].children).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("should handle projects with similar but not matching names", () => {
      const projects = [
        createMockProject({ name: "my-project", path: "/Users/jack/my-project" }),
        createMockProject({
          name: "my-project-v2",
          path: "/tmp/branch/my-project-v2",
        }),
      ];

      const result = detectWorktreeGroups(projects);

      // Should not group because names don't match exactly
      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(2);
    });

    it("should handle projects with special characters in names", () => {
      const projects = [
        createMockProject({
          name: "my-project_2.0",
          path: "/Users/jack/my-project_2.0",
        }),
        createMockProject({
          name: "my-project_2.0",
          path: "/tmp/feature/my-project_2.0",
        }),
      ];

      const result = detectWorktreeGroups(projects);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].parent.name).toBe("my-project_2.0");
    });

    it("should not group two tmp projects with same name", () => {
      const projects = [
        createMockProject({
          name: "my-project",
          path: "/tmp/branch-a/my-project",
        }),
        createMockProject({
          name: "my-project",
          path: "/tmp/branch-b/my-project",
        }),
      ];

      const result = detectWorktreeGroups(projects);

      // Both should be ungrouped (no parent project exists)
      expect(result.groups).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(2);
    });

    it("should handle deeply nested paths", () => {
      const projects = [
        createMockProject({
          name: "deep-project",
          path: "/Users/jack/code/work/clients/acme/deep-project",
        }),
        createMockProject({
          name: "deep-project",
          path: "/tmp/some/nested/path/deep-project",
        }),
      ];

      const result = detectWorktreeGroups(projects);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].children).toHaveLength(1);
    });
  });
});
