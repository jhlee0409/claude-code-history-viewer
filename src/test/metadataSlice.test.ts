/**
 * Tests for metadataSlice.ts
 *
 * Tests the Zustand slice for user metadata management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "zustand";
import type {
  UserMetadata,
  SessionMetadata,
  ProjectMetadata,
  UserSettings,
} from "../types";
import { DEFAULT_USER_METADATA } from "../types";
import {
  createMetadataSlice,
  initialMetadataState,
  type MetadataSlice,
  type MetadataSliceState,
} from "../store/slices/metadataSlice";
import type { FullAppStore } from "../store/slices/types";

// ============================================================================
// Mock Tauri API
// ============================================================================

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ============================================================================
// Test Store Setup
// ============================================================================

/**
 * Create a test store with only the metadata slice.
 * This allows us to test the slice in isolation.
 */
const createTestStore = () => {
  return create<MetadataSlice>()((set, get) => ({
    ...createMetadataSlice(
      set as unknown as Parameters<typeof createMetadataSlice>[0],
      get as unknown as Parameters<typeof createMetadataSlice>[1]
    ),
  }));
};

// ============================================================================
// Tests
// ============================================================================

describe("metadataSlice", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Initial State Tests
  // ==========================================================================

  describe("initialMetadataState", () => {
    it("should have correct initial state", () => {
      expect(initialMetadataState).toEqual({
        userMetadata: DEFAULT_USER_METADATA,
        isMetadataLoaded: false,
        isMetadataLoading: false,
        metadataError: null,
      });
    });

    it("should have userMetadata with version 1", () => {
      expect(initialMetadataState.userMetadata.version).toBe(1);
    });

    it("should have empty sessions object", () => {
      expect(initialMetadataState.userMetadata.sessions).toEqual({});
    });

    it("should have empty projects object", () => {
      expect(initialMetadataState.userMetadata.projects).toEqual({});
    });

    it("should have empty settings object", () => {
      expect(initialMetadataState.userMetadata.settings).toEqual({});
    });
  });

  describe("createMetadataSlice", () => {
    it("should create a store with initial state", () => {
      const useStore = createTestStore();
      const state = useStore.getState();

      expect(state.userMetadata).toEqual(DEFAULT_USER_METADATA);
      expect(state.isMetadataLoaded).toBe(false);
      expect(state.isMetadataLoading).toBe(false);
      expect(state.metadataError).toBeNull();
    });
  });

  // ==========================================================================
  // loadMetadata Tests
  // ==========================================================================

  describe("loadMetadata", () => {
    it("should set isMetadataLoading to true when loading", async () => {
      const useStore = createTestStore();

      mockInvoke.mockImplementation(() => new Promise(() => {})); // Never resolves

      // Start loading without awaiting
      useStore.getState().loadMetadata();

      // Check loading state
      expect(useStore.getState().isMetadataLoading).toBe(true);
      expect(useStore.getState().metadataError).toBeNull();
    });

    it("should load metadata successfully", async () => {
      const useStore = createTestStore();

      const mockMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "Test Session" },
        },
        projects: {
          "/path/to/project": { alias: "Test Project" },
        },
        settings: {
          hiddenPatterns: ["temp-*"],
        },
      };

      mockInvoke.mockResolvedValue(mockMetadata);

      await useStore.getState().loadMetadata();

      expect(mockInvoke).toHaveBeenCalledWith("load_user_metadata");
      expect(useStore.getState().userMetadata).toEqual(mockMetadata);
      expect(useStore.getState().isMetadataLoaded).toBe(true);
      expect(useStore.getState().isMetadataLoading).toBe(false);
    });

    it("should handle load error gracefully", async () => {
      const useStore = createTestStore();

      mockInvoke.mockRejectedValue(new Error("Failed to load"));

      await useStore.getState().loadMetadata();

      expect(useStore.getState().userMetadata).toEqual(DEFAULT_USER_METADATA);
      expect(useStore.getState().isMetadataLoaded).toBe(true);
      expect(useStore.getState().isMetadataLoading).toBe(false);
      expect(useStore.getState().metadataError).toBe("Error: Failed to load");
    });
  });

  // ==========================================================================
  // saveMetadata Tests
  // ==========================================================================

  describe("saveMetadata", () => {
    it("should save current metadata to backend", async () => {
      const useStore = createTestStore();

      // First load some metadata
      const mockMetadata: UserMetadata = {
        version: 1,
        sessions: { "session-1": { starred: true } },
        projects: {},
        settings: {},
      };

      mockInvoke.mockResolvedValueOnce(mockMetadata);
      await useStore.getState().loadMetadata();

      mockInvoke.mockResolvedValueOnce(undefined);
      await useStore.getState().saveMetadata();

      expect(mockInvoke).toHaveBeenLastCalledWith("save_user_metadata", {
        metadata: mockMetadata,
      });
    });

    it("should handle save error", async () => {
      const useStore = createTestStore();

      mockInvoke.mockRejectedValue(new Error("Save failed"));

      await useStore.getState().saveMetadata();

      expect(useStore.getState().metadataError).toBe("Error: Save failed");
    });
  });

  // ==========================================================================
  // updateSessionMetadata Tests
  // ==========================================================================

  describe("updateSessionMetadata", () => {
    it("should update session metadata with new values", async () => {
      const useStore = createTestStore();

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "New Name" },
        },
        projects: {},
        settings: {},
      };

      mockInvoke.mockResolvedValue(updatedMetadata);

      await useStore.getState().updateSessionMetadata("session-1", {
        customName: "New Name",
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { customName: "New Name" },
      });
      expect(useStore.getState().userMetadata).toEqual(updatedMetadata);
    });

    it("should merge with existing session metadata", async () => {
      const useStore = createTestStore();

      // First load metadata with existing session
      const initialMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "Original", starred: false },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValueOnce(initialMetadata);
      await useStore.getState().loadMetadata();

      // Update should merge
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "Original", starred: true },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValueOnce(updatedMetadata);

      await useStore.getState().updateSessionMetadata("session-1", {
        starred: true,
      });

      expect(mockInvoke).toHaveBeenLastCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { customName: "Original", starred: true },
      });
    });

    it("should handle update error", async () => {
      const useStore = createTestStore();

      mockInvoke.mockRejectedValue(new Error("Update failed"));

      await useStore.getState().updateSessionMetadata("session-1", {
        starred: true,
      });

      expect(useStore.getState().metadataError).toBe("Error: Update failed");
    });
  });

  // ==========================================================================
  // updateProjectMetadata Tests
  // ==========================================================================

  describe("updateProjectMetadata", () => {
    it("should update project metadata with new values", async () => {
      const useStore = createTestStore();

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {
          "/path/to/project": { hidden: true },
        },
        settings: {},
      };

      mockInvoke.mockResolvedValue(updatedMetadata);

      await useStore.getState().updateProjectMetadata("/path/to/project", {
        hidden: true,
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_project_metadata", {
        projectPath: "/path/to/project",
        update: { hidden: true },
      });
      expect(useStore.getState().userMetadata).toEqual(updatedMetadata);
    });

    it("should merge with existing project metadata", async () => {
      const useStore = createTestStore();

      // Load metadata with existing project
      const initialMetadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {
          "/path/to/project": { alias: "My Project", hidden: false },
        },
        settings: {},
      };
      mockInvoke.mockResolvedValueOnce(initialMetadata);
      await useStore.getState().loadMetadata();

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {
          "/path/to/project": { alias: "My Project", hidden: true },
        },
        settings: {},
      };
      mockInvoke.mockResolvedValueOnce(updatedMetadata);

      await useStore.getState().updateProjectMetadata("/path/to/project", {
        hidden: true,
      });

      expect(mockInvoke).toHaveBeenLastCalledWith("update_project_metadata", {
        projectPath: "/path/to/project",
        update: { alias: "My Project", hidden: true },
      });
    });

    it("should handle update error", async () => {
      const useStore = createTestStore();

      mockInvoke.mockRejectedValue(new Error("Project update failed"));

      await useStore.getState().updateProjectMetadata("/path/to/project", {
        alias: "Test",
      });

      expect(useStore.getState().metadataError).toBe(
        "Error: Project update failed"
      );
    });
  });

  // ==========================================================================
  // updateUserSettings Tests
  // ==========================================================================

  describe("updateUserSettings", () => {
    it("should update user settings", async () => {
      const useStore = createTestStore();

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["temp-*", "backup-*"],
          worktreeGrouping: true,
        },
      };

      mockInvoke.mockResolvedValue(updatedMetadata);

      await useStore.getState().updateUserSettings({
        hiddenPatterns: ["temp-*", "backup-*"],
        worktreeGrouping: true,
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_user_settings", {
        settings: {
          hiddenPatterns: ["temp-*", "backup-*"],
          worktreeGrouping: true,
        },
      });
      expect(useStore.getState().userMetadata).toEqual(updatedMetadata);
    });

    it("should merge with existing settings", async () => {
      const useStore = createTestStore();

      // Load with existing settings
      const initialMetadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["old-pattern"],
        },
      };
      mockInvoke.mockResolvedValueOnce(initialMetadata);
      await useStore.getState().loadMetadata();

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["old-pattern"],
          worktreeGrouping: true,
        },
      };
      mockInvoke.mockResolvedValueOnce(updatedMetadata);

      await useStore.getState().updateUserSettings({
        worktreeGrouping: true,
      });

      expect(mockInvoke).toHaveBeenLastCalledWith("update_user_settings", {
        settings: {
          hiddenPatterns: ["old-pattern"],
          worktreeGrouping: true,
        },
      });
    });

    it("should handle update error", async () => {
      const useStore = createTestStore();

      mockInvoke.mockRejectedValue(new Error("Settings update failed"));

      await useStore.getState().updateUserSettings({
        worktreeGrouping: true,
      });

      expect(useStore.getState().metadataError).toBe(
        "Error: Settings update failed"
      );
    });
  });

  // ==========================================================================
  // getSessionDisplayName Tests
  // ==========================================================================

  describe("getSessionDisplayName", () => {
    it("should return undefined when session has no metadata", () => {
      const useStore = createTestStore();

      const displayName = useStore
        .getState()
        .getSessionDisplayName("nonexistent");

      expect(displayName).toBeUndefined();
    });

    it("should return fallback when session has no customName", () => {
      const useStore = createTestStore();

      const displayName = useStore
        .getState()
        .getSessionDisplayName("session-1", "Fallback Summary");

      expect(displayName).toBe("Fallback Summary");
    });

    it("should return customName when set", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "Custom Display Name" },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      const displayName = useStore.getState().getSessionDisplayName("session-1");

      expect(displayName).toBe("Custom Display Name");
    });

    it("should prefer customName over fallback", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "Custom Name" },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      const displayName = useStore
        .getState()
        .getSessionDisplayName("session-1", "Fallback");

      expect(displayName).toBe("Custom Name");
    });

    it("should return fallback when customName is empty", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "" },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      const displayName = useStore
        .getState()
        .getSessionDisplayName("session-1", "Fallback");

      expect(displayName).toBe("Fallback");
    });
  });

  // ==========================================================================
  // isProjectHidden Tests
  // ==========================================================================

  describe("isProjectHidden", () => {
    it("should return false when project has no metadata", () => {
      const useStore = createTestStore();

      const isHidden = useStore.getState().isProjectHidden("/some/path");

      expect(isHidden).toBe(false);
    });

    it("should return true when project is explicitly hidden", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {
          "/hidden/project": { hidden: true },
        },
        settings: {},
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      const isHidden = useStore.getState().isProjectHidden("/hidden/project");

      expect(isHidden).toBe(true);
    });

    it("should return false when project is explicitly visible", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {
          "/visible/project": { hidden: false },
        },
        settings: {},
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      const isHidden = useStore.getState().isProjectHidden("/visible/project");

      expect(isHidden).toBe(false);
    });

    it("should match hidden pattern with wildcard", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["temp-*"],
        },
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      expect(useStore.getState().isProjectHidden("temp-folder")).toBe(true);
      expect(useStore.getState().isProjectHidden("temp-project")).toBe(true);
      expect(useStore.getState().isProjectHidden("other-folder")).toBe(false);
    });

    it("should match multiple patterns", async () => {
      const useStore = createTestStore();

      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["temp-*", "backup-*", "*.old"],
        },
      };
      mockInvoke.mockResolvedValue(metadata);
      await useStore.getState().loadMetadata();

      expect(useStore.getState().isProjectHidden("temp-test")).toBe(true);
      expect(useStore.getState().isProjectHidden("backup-data")).toBe(true);
      expect(useStore.getState().isProjectHidden("file.old")).toBe(true);
      expect(useStore.getState().isProjectHidden("normal-project")).toBe(false);
    });
  });

  // ==========================================================================
  // clearMetadataError Tests
  // ==========================================================================

  describe("clearMetadataError", () => {
    it("should clear the metadata error", async () => {
      const useStore = createTestStore();

      // Set an error
      mockInvoke.mockRejectedValue(new Error("Test error"));
      await useStore.getState().loadMetadata();
      expect(useStore.getState().metadataError).toBe("Error: Test error");

      // Clear the error
      useStore.getState().clearMetadataError();

      expect(useStore.getState().metadataError).toBeNull();
    });
  });
});
