import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

export type NavigatorViewMode = "list" | "outline";

/**
 * The message navigator's own state. Whether it shows is the inspector's
 * (`inspectorSlice.ts`): the navigator is the inspector's Outline tab.
 */
export interface NavigatorSliceState {
    /** List (flat, default) or outline (grouped by turn) rendering mode */
    navigatorViewMode: NavigatorViewMode;
    /** uuid of the message currently visible in the main transcript; not persisted */
    visibleMessageUuid: string | null;
}

export interface NavigatorSliceActions {
    setNavigatorViewMode: (mode: NavigatorViewMode) => void;
    toggleNavigatorViewMode: () => void;
    setVisibleMessageUuid: (uuid: string | null) => void;
}

export type NavigatorSlice = NavigatorSliceState & NavigatorSliceActions;

const VIEW_MODE_STORAGE_KEY = "navigator-view-mode";

function readStoredViewMode(): NavigatorViewMode {
    try {
        const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
        return stored === "outline" ? "outline" : "list";
    } catch {
        return "list";
    }
}

export const createNavigatorSlice: StateCreator<
    FullAppStore,
    [],
    [],
    NavigatorSlice
> = (set, get) => ({
    navigatorViewMode: readStoredViewMode(),

    visibleMessageUuid: null,

    setNavigatorViewMode: (mode) => {
        try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
        set({ navigatorViewMode: mode });
    },

    toggleNavigatorViewMode: () => set((state) => {
        const next: NavigatorViewMode = state.navigatorViewMode === "list" ? "outline" : "list";
        try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, next); } catch { /* ignore */ }
        return { navigatorViewMode: next };
    }),

    setVisibleMessageUuid: (uuid) => {
        if (get().visibleMessageUuid === uuid) return;
        set({ visibleMessageUuid: uuid });
    },
});
