/**
 * Session Metadata Hook
 *
 * Provides easy access to session-specific metadata from the user metadata store.
 * Manages custom names, starred status, tags, and notes for individual sessions.
 *
 * @example Basic Usage
 * ```typescript
 * const {
 *   customName,
 *   starred,
 *   tags,
 *   setCustomName,
 *   toggleStarred,
 *   addTag,
 *   setNotes
 * } = useSessionMetadata("session-uuid-123");
 *
 * // Update session name
 * await setCustomName("My Important Session");
 *
 * // Star the session
 * await toggleStarred();
 *
 * // Add tags
 * await addTag("debugging");
 * await addTag("production-fix");
 * ```
 *
 * @example With Display Name
 * ```typescript
 * const displayName = useSessionDisplayName(
 *   "session-uuid-123",
 *   "Default Session Name"
 * );
 * // Returns customName if set, otherwise fallback
 * ```
 *
 * @remarks
 * **Persistence:**
 * - All updates automatically save to `~/.claude/metadata.json`
 * - Changes propagate to all components via Zustand store
 *
 * **Performance:**
 * - Memoized values prevent unnecessary re-renders
 * - Only subscribes to specific session data
 */

import { useCallback, useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import type { SessionMetadata } from "../types";

/**
 * Hook for accessing and updating session metadata
 *
 * @param sessionId - The unique session identifier (UUID)
 * @returns Session metadata state and update functions
 */
export const useSessionMetadata = (sessionId: string) => {
  const userMetadata = useAppStore((state) => state.userMetadata);
  const updateSessionMetadata = useAppStore(
    (state) => state.updateSessionMetadata
  );
  const isMetadataLoaded = useAppStore((state) => state.isMetadataLoaded);

  /**
   * Get current session metadata from store
   * Memoized to prevent unnecessary re-renders
   */
  const sessionMetadata = useMemo<SessionMetadata | undefined>(
    () => userMetadata.sessions[sessionId],
    [userMetadata.sessions, sessionId]
  );

  // Derived values with safe defaults
  const customName = sessionMetadata?.customName;
  const starred = sessionMetadata?.starred ?? false;
  const tags = useMemo(
    () => sessionMetadata?.tags ?? [],
    [sessionMetadata?.tags]
  );
  const notes = sessionMetadata?.notes;

  /**
   * Set or clear custom session name
   * @param name - Custom name or undefined to clear
   */
  const setCustomName = useCallback(
    async (name: string | undefined) => {
      await updateSessionMetadata(sessionId, { customName: name });
    },
    [sessionId, updateSessionMetadata]
  );

  /**
   * Toggle starred status (star/unstar)
   */
  const toggleStarred = useCallback(async () => {
    await updateSessionMetadata(sessionId, { starred: !starred });
  }, [sessionId, starred, updateSessionMetadata]);

  /**
   * Set starred status explicitly
   * @param value - true to star, false to unstar
   */
  const setStarred = useCallback(
    async (value: boolean) => {
      await updateSessionMetadata(sessionId, { starred: value });
    },
    [sessionId, updateSessionMetadata]
  );

  /**
   * Add a tag to the session (no-op if already exists)
   * @param tag - Tag string to add
   */
  const addTag = useCallback(
    async (tag: string) => {
      if (!tags.includes(tag)) {
        await updateSessionMetadata(sessionId, { tags: [...tags, tag] });
      }
    },
    [sessionId, tags, updateSessionMetadata]
  );

  /**
   * Remove a tag from the session
   * @param tag - Tag string to remove
   */
  const removeTag = useCallback(
    async (tag: string) => {
      await updateSessionMetadata(sessionId, {
        tags: tags.filter((t) => t !== tag),
      });
    },
    [sessionId, tags, updateSessionMetadata]
  );

  /**
   * Replace all tags with a new array
   * @param newTags - Complete array of tags
   */
  const setTags = useCallback(
    async (newTags: string[]) => {
      await updateSessionMetadata(sessionId, { tags: newTags });
    },
    [sessionId, updateSessionMetadata]
  );

  /**
   * Set or clear session notes
   * @param newNotes - Notes text or undefined to clear
   */
  const setNotes = useCallback(
    async (newNotes: string | undefined) => {
      await updateSessionMetadata(sessionId, { notes: newNotes });
    },
    [sessionId, updateSessionMetadata]
  );

  return {
    // State
    sessionMetadata,
    customName,
    starred,
    tags,
    notes,
    isMetadataLoaded,

    // Actions
    setCustomName,
    toggleStarred,
    setStarred,
    addTag,
    removeTag,
    setTags,
    setNotes,
  };
};

/**
 * Hook for getting display name for a session
 *
 * Returns custom name if set, otherwise falls back to provided summary.
 * Optimized to only re-render when the specific session's customName changes.
 *
 * @param sessionId - Session UUID
 * @param fallbackSummary - Default name to use if no custom name is set
 * @returns Display name (custom name or fallback)
 *
 * @example
 * ```typescript
 * const displayName = useSessionDisplayName(
 *   session.id,
 *   session.summary || "Untitled Session"
 * );
 * ```
 */
export const useSessionDisplayName = (
  sessionId: string,
  fallbackSummary?: string
): string | undefined => {
  // Narrow subscription - only re-renders when this specific session's customName changes
  const customName = useAppStore(
    (state) => state.userMetadata.sessions[sessionId]?.customName
  );

  return useMemo(
    () => customName || fallbackSummary,
    [customName, fallbackSummary]
  );
};
