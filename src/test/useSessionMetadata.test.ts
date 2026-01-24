/**
 * Tests for useSessionMetadata.ts
 *
 * Tests the React hook for accessing session metadata.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessionMetadata, useSessionDisplayName } from "../hooks/useSessionMetadata";
import { useAppStore } from "../store/useAppStore";
import type { UserMetadata } from "../types";

// ============================================================================
// Mock Tauri API
// ============================================================================

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Reset the store to its initial state before each test.
 */
const resetStore = () => {
  useAppStore.setState({
    userMetadata: {
      version: 1,
      sessions: {},
      projects: {},
      settings: {},
    },
    isMetadataLoaded: false,
    isMetadataLoading: false,
    metadataError: null,
  });
};

/**
 * Set up the store with pre-loaded metadata.
 */
const setupStoreWithMetadata = (metadata: UserMetadata) => {
  useAppStore.setState({
    userMetadata: metadata,
    isMetadataLoaded: true,
    isMetadataLoading: false,
    metadataError: null,
  });
};

// ============================================================================
// Tests
// ============================================================================

describe("useSessionMetadata", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Initial State Tests
  // ==========================================================================

  describe("initial state", () => {
    it("should return undefined sessionMetadata for non-existent session", () => {
      const { result } = renderHook(() => useSessionMetadata("non-existent"));

      expect(result.current.sessionMetadata).toBeUndefined();
    });

    it("should return default values when no metadata exists", () => {
      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.customName).toBeUndefined();
      expect(result.current.starred).toBe(false);
      expect(result.current.tags).toEqual([]);
      expect(result.current.notes).toBeUndefined();
    });

    it("should return isMetadataLoaded from store", () => {
      useAppStore.setState({ isMetadataLoaded: true });

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.isMetadataLoaded).toBe(true);
    });
  });

  // ==========================================================================
  // Reading Metadata Tests
  // ==========================================================================

  describe("reading metadata", () => {
    it("should return session metadata when it exists", () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": {
            customName: "My Session",
            starred: true,
            tags: ["important", "work"],
            notes: "Some notes",
          },
        },
        projects: {},
        settings: {},
      });

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.sessionMetadata).toEqual({
        customName: "My Session",
        starred: true,
        tags: ["important", "work"],
        notes: "Some notes",
      });
      expect(result.current.customName).toBe("My Session");
      expect(result.current.starred).toBe(true);
      expect(result.current.tags).toEqual(["important", "work"]);
      expect(result.current.notes).toBe("Some notes");
    });

    it("should return undefined customName when not set", () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { starred: true },
        },
        projects: {},
        settings: {},
      });

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.customName).toBeUndefined();
    });

    it("should return false for starred when not set", () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { customName: "Test" },
        },
        projects: {},
        settings: {},
      });

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.starred).toBe(false);
    });

    it("should return empty array for tags when not set", () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { customName: "Test" },
        },
        projects: {},
        settings: {},
      });

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.tags).toEqual([]);
    });
  });

  // ==========================================================================
  // setCustomName Tests
  // ==========================================================================

  describe("setCustomName", () => {
    it("should call updateSessionMetadata with new name", async () => {
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "New Name" },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setCustomName("New Name");
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { customName: "New Name" },
      });
    });

    it("should update customName in state after setting", async () => {
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: "Updated Name" },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setCustomName("Updated Name");
      });

      await waitFor(() => {
        expect(result.current.customName).toBe("Updated Name");
      });
    });

    it("should allow clearing customName with undefined", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { customName: "Existing Name" },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { customName: undefined },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setCustomName(undefined);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: expect.objectContaining({ customName: undefined }),
      });
    });
  });

  // ==========================================================================
  // toggleStarred Tests
  // ==========================================================================

  describe("toggleStarred", () => {
    it("should toggle starred from false to true", async () => {
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { starred: true },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.starred).toBe(false);

      await act(async () => {
        await result.current.toggleStarred();
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { starred: true },
      });
    });

    it("should toggle starred from true to false", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { starred: true },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { starred: false },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.starred).toBe(true);

      await act(async () => {
        await result.current.toggleStarred();
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { starred: false },
      });
    });
  });

  // ==========================================================================
  // setStarred Tests
  // ==========================================================================

  describe("setStarred", () => {
    it("should set starred to true", async () => {
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { starred: true },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setStarred(true);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { starred: true },
      });
    });

    it("should set starred to false", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { starred: true },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { starred: false },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setStarred(false);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: expect.objectContaining({ starred: false }),
      });
    });
  });

  // ==========================================================================
  // addTag Tests
  // ==========================================================================

  describe("addTag", () => {
    it("should add a new tag", async () => {
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { tags: ["new-tag"] },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.addTag("new-tag");
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { tags: ["new-tag"] },
      });
    });

    it("should add tag to existing tags", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { tags: ["existing-tag"] },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { tags: ["existing-tag", "new-tag"] },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.addTag("new-tag");
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { tags: ["existing-tag", "new-tag"] },
      });
    });

    it("should not add duplicate tag", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { tags: ["existing-tag"] },
        },
        projects: {},
        settings: {},
      });

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.addTag("existing-tag");
      });

      // Should not call updateSessionMetadata because tag already exists
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // removeTag Tests
  // ==========================================================================

  describe("removeTag", () => {
    it("should remove an existing tag", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { tags: ["tag1", "tag2", "tag3"] },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { tags: ["tag1", "tag3"] },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.removeTag("tag2");
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { tags: ["tag1", "tag3"] },
      });
    });

    it("should handle removing non-existent tag", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { tags: ["tag1"] },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { tags: ["tag1"] },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.removeTag("non-existent");
      });

      // Still calls the update (filter just returns same array)
      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { tags: ["tag1"] },
      });
    });
  });

  // ==========================================================================
  // setTags Tests
  // ==========================================================================

  describe("setTags", () => {
    it("should replace all tags", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { tags: ["old-tag1", "old-tag2"] },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { tags: ["new-tag1", "new-tag2", "new-tag3"] },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setTags(["new-tag1", "new-tag2", "new-tag3"]);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: expect.objectContaining({ tags: ["new-tag1", "new-tag2", "new-tag3"] }),
      });
    });

    it("should clear all tags with empty array", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { tags: ["tag1", "tag2"] },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { tags: [] },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setTags([]);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: expect.objectContaining({ tags: [] }),
      });
    });
  });

  // ==========================================================================
  // setNotes Tests
  // ==========================================================================

  describe("setNotes", () => {
    it("should set notes", async () => {
      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { notes: "New notes content" },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setNotes("New notes content");
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: { notes: "New notes content" },
      });
    });

    it("should clear notes with undefined", async () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { notes: "Existing notes" },
        },
        projects: {},
        settings: {},
      });

      const updatedMetadata: UserMetadata = {
        version: 1,
        sessions: {
          "session-1": { notes: undefined },
        },
        projects: {},
        settings: {},
      };
      mockInvoke.mockResolvedValue(updatedMetadata);

      const { result } = renderHook(() => useSessionMetadata("session-1"));

      await act(async () => {
        await result.current.setNotes(undefined);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_session_metadata", {
        sessionId: "session-1",
        update: expect.objectContaining({ notes: undefined }),
      });
    });
  });

  // ==========================================================================
  // Hook Reactivity Tests
  // ==========================================================================

  describe("reactivity", () => {
    it("should update when store metadata changes", async () => {
      const { result } = renderHook(() => useSessionMetadata("session-1"));

      expect(result.current.customName).toBeUndefined();

      act(() => {
        useAppStore.setState({
          userMetadata: {
            version: 1,
            sessions: {
              "session-1": { customName: "Updated via store" },
            },
            projects: {},
            settings: {},
          },
        });
      });

      await waitFor(() => {
        expect(result.current.customName).toBe("Updated via store");
      });
    });

    it("should update when different session is targeted", () => {
      setupStoreWithMetadata({
        version: 1,
        sessions: {
          "session-1": { customName: "Session 1" },
          "session-2": { customName: "Session 2" },
        },
        projects: {},
        settings: {},
      });

      const { result, rerender } = renderHook(
        ({ sessionId }) => useSessionMetadata(sessionId),
        { initialProps: { sessionId: "session-1" } }
      );

      expect(result.current.customName).toBe("Session 1");

      rerender({ sessionId: "session-2" });

      expect(result.current.customName).toBe("Session 2");
    });
  });
});

// ============================================================================
// useSessionDisplayName Tests
// ============================================================================

describe("useSessionDisplayName", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return undefined when no metadata and no fallback", () => {
    const { result } = renderHook(() => useSessionDisplayName("session-1"));

    expect(result.current).toBeUndefined();
  });

  it("should return fallback when no customName", () => {
    const { result } = renderHook(() =>
      useSessionDisplayName("session-1", "Fallback Summary")
    );

    expect(result.current).toBe("Fallback Summary");
  });

  it("should return customName when set", () => {
    setupStoreWithMetadata({
      version: 1,
      sessions: {
        "session-1": { customName: "Custom Display Name" },
      },
      projects: {},
      settings: {},
    });

    const { result } = renderHook(() => useSessionDisplayName("session-1"));

    expect(result.current).toBe("Custom Display Name");
  });

  it("should prefer customName over fallback", () => {
    setupStoreWithMetadata({
      version: 1,
      sessions: {
        "session-1": { customName: "Custom Name" },
      },
      projects: {},
      settings: {},
    });

    const { result } = renderHook(() =>
      useSessionDisplayName("session-1", "Fallback")
    );

    expect(result.current).toBe("Custom Name");
  });

  it("should return fallback when customName is empty string", () => {
    setupStoreWithMetadata({
      version: 1,
      sessions: {
        "session-1": { customName: "" },
      },
      projects: {},
      settings: {},
    });

    const { result } = renderHook(() =>
      useSessionDisplayName("session-1", "Fallback")
    );

    expect(result.current).toBe("Fallback");
  });

  it("should update when sessionId changes", () => {
    setupStoreWithMetadata({
      version: 1,
      sessions: {
        "session-1": { customName: "Session 1 Name" },
        "session-2": { customName: "Session 2 Name" },
      },
      projects: {},
      settings: {},
    });

    const { result, rerender } = renderHook(
      ({ sessionId, fallback }) => useSessionDisplayName(sessionId, fallback),
      { initialProps: { sessionId: "session-1", fallback: "Fallback" } }
    );

    expect(result.current).toBe("Session 1 Name");

    rerender({ sessionId: "session-2", fallback: "Fallback" });

    expect(result.current).toBe("Session 2 Name");
  });

  it("should update when fallback changes and no customName", () => {
    const { result, rerender } = renderHook(
      ({ sessionId, fallback }) => useSessionDisplayName(sessionId, fallback),
      { initialProps: { sessionId: "session-1", fallback: "Initial Fallback" } }
    );

    expect(result.current).toBe("Initial Fallback");

    rerender({ sessionId: "session-1", fallback: "New Fallback" });

    expect(result.current).toBe("New Fallback");
  });
});
