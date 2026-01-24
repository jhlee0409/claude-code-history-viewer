/**
 * Session Metadata Hook
 *
 * Provides easy access to session-specific metadata
 * from the user metadata store.
 */

import { useCallback, useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import type { SessionMetadata } from "../types";

/**
 * Hook for accessing and updating session metadata
 * @param sessionId - The unique session identifier
 */
export const useSessionMetadata = (sessionId: string) => {
  const userMetadata = useAppStore((state) => state.userMetadata);
  const updateSessionMetadata = useAppStore(
    (state) => state.updateSessionMetadata
  );
  const isMetadataLoaded = useAppStore((state) => state.isMetadataLoaded);

  // Get current session metadata
  const sessionMetadata = useMemo<SessionMetadata | undefined>(
    () => userMetadata.sessions[sessionId],
    [userMetadata.sessions, sessionId]
  );

  // Derived values
  const customName = sessionMetadata?.customName;
  const starred = sessionMetadata?.starred ?? false;
  const tags = sessionMetadata?.tags ?? [];
  const notes = sessionMetadata?.notes;

  // Actions
  const setCustomName = useCallback(
    async (name: string | undefined) => {
      await updateSessionMetadata(sessionId, { customName: name });
    },
    [sessionId, updateSessionMetadata]
  );

  const toggleStarred = useCallback(async () => {
    await updateSessionMetadata(sessionId, { starred: !starred });
  }, [sessionId, starred, updateSessionMetadata]);

  const setStarred = useCallback(
    async (value: boolean) => {
      await updateSessionMetadata(sessionId, { starred: value });
    },
    [sessionId, updateSessionMetadata]
  );

  const addTag = useCallback(
    async (tag: string) => {
      if (!tags.includes(tag)) {
        await updateSessionMetadata(sessionId, { tags: [...tags, tag] });
      }
    },
    [sessionId, tags, updateSessionMetadata]
  );

  const removeTag = useCallback(
    async (tag: string) => {
      await updateSessionMetadata(sessionId, {
        tags: tags.filter((t) => t !== tag),
      });
    },
    [sessionId, tags, updateSessionMetadata]
  );

  const setTags = useCallback(
    async (newTags: string[]) => {
      await updateSessionMetadata(sessionId, { tags: newTags });
    },
    [sessionId, updateSessionMetadata]
  );

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
 * Returns custom name if set, otherwise fallback summary
 */
export const useSessionDisplayName = (
  sessionId: string,
  fallbackSummary?: string
): string | undefined => {
  // Subscribe to the specific session's customName to trigger re-renders
  const customName = useAppStore(
    (state) => state.userMetadata.sessions[sessionId]?.customName
  );

  return useMemo(
    () => customName || fallbackSummary,
    [customName, fallbackSummary]
  );
};
