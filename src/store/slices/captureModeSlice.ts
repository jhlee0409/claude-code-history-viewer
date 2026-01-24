/**
 * Capture Mode Slice
 *
 * Handles capture mode state for hiding message blocks during screenshot capture.
 * Uses hybrid approach: hiding only applies when capture mode is active.
 */

import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

// ============================================================================
// State Interface
// ============================================================================

export interface CaptureModeSliceState {
  /** Whether capture mode is currently active */
  isCaptureMode: boolean;
  /** List of hidden message UUIDs (persisted across mode toggles) */
  hiddenMessageIds: string[];
}

export interface CaptureModeSliceActions {
  /** Enter capture mode - hidden messages become invisible */
  enterCaptureMode: () => void;
  /** Exit capture mode - hidden messages become visible again (list preserved) */
  exitCaptureMode: () => void;
  /** Add a message to the hidden list */
  hideMessage: (uuid: string) => void;
  /** Remove a message from the hidden list */
  showMessage: (uuid: string) => void;
  /** Restore multiple messages by their UUIDs */
  restoreMessages: (uuids: string[]) => void;
  /** Clear all hidden messages */
  restoreAllMessages: () => void;
  /** Check if a message is hidden (only returns true when in capture mode) */
  isMessageHidden: (uuid: string) => boolean;
  /** Get count of hidden messages */
  getHiddenCount: () => number;
}

export type CaptureModeSlice = CaptureModeSliceState & CaptureModeSliceActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialCaptureModeState: CaptureModeSliceState = {
  isCaptureMode: false,
  hiddenMessageIds: [],
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createCaptureModeSlice: StateCreator<
  FullAppStore,
  [],
  [],
  CaptureModeSlice
> = (set, get) => ({
  ...initialCaptureModeState,

  enterCaptureMode: () => {
    set({ isCaptureMode: true });
  },

  exitCaptureMode: () => {
    set({ isCaptureMode: false });
  },

  hideMessage: (uuid: string) => {
    const { hiddenMessageIds } = get();
    if (!hiddenMessageIds.includes(uuid)) {
      set({ hiddenMessageIds: [...hiddenMessageIds, uuid] });
    }
  },

  showMessage: (uuid: string) => {
    const { hiddenMessageIds } = get();
    set({
      hiddenMessageIds: hiddenMessageIds.filter((id) => id !== uuid),
    });
  },

  restoreMessages: (uuids: string[]) => {
    const { hiddenMessageIds } = get();
    const uuidSet = new Set(uuids);
    set({
      hiddenMessageIds: hiddenMessageIds.filter((id) => !uuidSet.has(id)),
    });
  },

  restoreAllMessages: () => {
    set({ hiddenMessageIds: [] });
  },

  isMessageHidden: (uuid: string) => {
    const { isCaptureMode, hiddenMessageIds } = get();
    // Only consider messages hidden when in capture mode
    return isCaptureMode && hiddenMessageIds.includes(uuid);
  },

  getHiddenCount: () => {
    return get().hiddenMessageIds.length;
  },
});
