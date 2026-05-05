import type { StateCreator } from "zustand";
import type { ClaudeProject, ClaudeSession } from "@/types";
import type { FullAppStore } from "./types";

/**
 * Used by the `--session-title <text>` CLI flag when more than one session
 * matches the substring. The React side renders a picker modal listing the
 * candidates; the user picks one or dismisses.
 *
 * Also used (with a single candidate) to surface an "unambiguous but confirm"
 * flow if we ever want one; for now Stage B auto-selects on single match.
 */
export interface SessionPickerCandidate {
    project: ClaudeProject;
    session: ClaudeSession;
}

export interface SessionPickerSliceState {
    /** Candidate list when a CLI title hint matched multiple sessions. */
    sessionPickerCandidates: SessionPickerCandidate[] | null;
    /** The raw CLI value the user passed, e.g. "auth bug" — used for the modal header. */
    sessionPickerHintValue: string | null;
}

export interface SessionPickerSliceActions {
    openSessionPicker: (
        candidates: SessionPickerCandidate[],
        hintValue: string,
    ) => void;
    closeSessionPicker: () => void;
}

export type SessionPickerSlice = SessionPickerSliceState & SessionPickerSliceActions;

export const createSessionPickerSlice: StateCreator<
    FullAppStore,
    [],
    [],
    SessionPickerSlice
> = (set) => ({
    sessionPickerCandidates: null,
    sessionPickerHintValue: null,

    openSessionPicker: (candidates, hintValue) =>
        set({
            sessionPickerCandidates: candidates,
            sessionPickerHintValue: hintValue,
        }),

    closeSessionPicker: () =>
        set({
            sessionPickerCandidates: null,
            sessionPickerHintValue: null,
        }),
});
