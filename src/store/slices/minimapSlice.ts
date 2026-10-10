import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

export interface MinimapSliceState {
    /** Whether the session minimap strip is shown */
    isMinimapOpen: boolean;
}

export interface MinimapSliceActions {
    toggleMinimap: () => void;
    setMinimapOpen: (open: boolean) => void;
}

export type MinimapSlice = MinimapSliceState & MinimapSliceActions;

const STORAGE_KEY = "minimap-open";

export const createMinimapSlice: StateCreator<
    FullAppStore,
    [],
    [],
    MinimapSlice
> = (set) => ({
    isMinimapOpen: (() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored === null ? false : stored === "true";
        } catch {
            return false;
        }
    })(),

    toggleMinimap: () => set((state) => {
        const next = !state.isMinimapOpen;
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
        return { isMinimapOpen: next };
    }),

    setMinimapOpen: (open) => {
        try { localStorage.setItem(STORAGE_KEY, String(open)); } catch { /* ignore */ }
        set({ isMinimapOpen: open });
    },
});
