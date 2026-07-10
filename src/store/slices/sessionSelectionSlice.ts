/**
 * Session Selection Slice
 *
 * Handles multi-select mode for the project session list: an explicit
 * "select mode" toggle plus explorer-style multi-selection with Shift (range)
 * and Cmd/Ctrl (individual toggle). Powers mass operations (delete, copy IDs).
 *
 * Selection is scoped to the currently open project's session list — switching
 * or clearing the project resets it (see projectSlice). Mirrors the shape of
 * captureModeSlice, which does the same for message blocks.
 */

import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

// ============================================================================
// State Interface
// ============================================================================

export interface SessionSelectionSliceState {
  /** Whether multi-select mode is active for the session list */
  isSessionSelectionMode: boolean;
  /** Selected session IDs (ClaudeSession.session_id), ordered by selection */
  sessionSelectionIds: string[];
  /** Session ID of the selection anchor (for Shift range selection) */
  sessionSelectionAnchor: string | null;
}

export interface SessionSelectionSliceActions {
  /** Turn multi-select mode on */
  enterSessionSelectionMode: () => void;
  /** Turn multi-select mode off and clear the selection */
  exitSessionSelectionMode: () => void;
  /** Toggle multi-select mode (exiting clears the selection) */
  toggleSessionSelectionMode: () => void;
  /** Handle a selection click on a session row with modifier keys */
  handleSessionSelectionClick: (
    sessionId: string,
    orderedIds: string[],
    modifiers: { shift: boolean; cmdOrCtrl: boolean }
  ) => void;
  /** Replace the selection (used by "Select all") */
  setSessionSelectionIds: (ids: string[]) => void;
  /** Clear the selection but stay in select mode */
  clearSessionSelection: () => void;
}

export type SessionSelectionSlice = SessionSelectionSliceState &
  SessionSelectionSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialSessionSelectionState: SessionSelectionSliceState = {
  isSessionSelectionMode: false,
  sessionSelectionIds: [],
  sessionSelectionAnchor: null,
};

// ============================================================================
// Helpers
// ============================================================================

/** Inclusive range of IDs between two IDs in an ordered list. */
function getRange(orderedIds: string[], fromId: string, toId: string): string[] {
  const fromIdx = orderedIds.indexOf(fromId);
  const toIdx = orderedIds.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return [toId];
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return orderedIds.slice(lo, hi + 1);
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createSessionSelectionSlice: StateCreator<
  FullAppStore,
  [],
  [],
  SessionSelectionSlice
> = (set, get) => ({
  ...initialSessionSelectionState,

  enterSessionSelectionMode: () => {
    set({ isSessionSelectionMode: true });
  },

  exitSessionSelectionMode: () => {
    set({
      isSessionSelectionMode: false,
      sessionSelectionIds: [],
      sessionSelectionAnchor: null,
    });
  },

  toggleSessionSelectionMode: () => {
    if (get().isSessionSelectionMode) {
      get().exitSessionSelectionMode();
    } else {
      set({ isSessionSelectionMode: true });
    }
  },

  handleSessionSelectionClick: (sessionId, orderedIds, { shift }) => {
    const { sessionSelectionIds, sessionSelectionAnchor } = get();

    if (shift) {
      // Shift: add the anchor→clicked range to the current selection. Anchor
      // stays so the range can be re-extended from the same origin.
      const anchor = sessionSelectionAnchor ?? sessionId;
      const range = getRange(orderedIds, anchor, sessionId);
      const merged = new Set(sessionSelectionIds);
      for (const id of range) merged.add(id);
      set({
        sessionSelectionIds: [...merged],
        sessionSelectionAnchor: anchor,
      });
      return;
    }

    // Plain click or Cmd/Ctrl click: toggle this row, move the anchor to it.
    // (In explicit select mode a plain click already toggles, so Cmd/Ctrl is
    // treated the same — both differ from Shift only.)
    const existing = new Set(sessionSelectionIds);
    if (existing.has(sessionId)) {
      existing.delete(sessionId);
    } else {
      existing.add(sessionId);
    }
    set({
      sessionSelectionIds: [...existing],
      sessionSelectionAnchor: sessionId,
    });
  },

  setSessionSelectionIds: (ids: string[]) => {
    set({ sessionSelectionIds: [...ids] });
  },

  clearSessionSelection: () => {
    set({ sessionSelectionIds: [], sessionSelectionAnchor: null });
  },
});
