import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

export type NavigatorViewMode = "list" | "outline";

export interface NavigatorSliceState {
    /** Whether the right sidebar navigator is expanded */
    isNavigatorOpen: boolean;
    /** List (flat, default) or outline (grouped by turn) rendering mode */
    navigatorViewMode: NavigatorViewMode;
    /** uuid of the message currently visible in the main transcript; not persisted */
    visibleMessageUuid: string | null;
}

export interface NavigatorSliceActions {
    toggleNavigator: () => void;
    setNavigatorOpen: (open: boolean) => void;
    setNavigatorViewMode: (mode: NavigatorViewMode) => void;
    toggleNavigatorViewMode: () => void;
    setVisibleMessageUuid: (uuid: string | null) => void;
}

export type NavigatorSlice = NavigatorSliceState & NavigatorSliceActions;

const STORAGE_KEY = "navigator-open";
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
    isNavigatorOpen: (() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored === null ? true : stored === "true";
        } catch {
            return true;
        }
    })(),

    navigatorViewMode: readStoredViewMode(),

    visibleMessageUuid: null,

    toggleNavigator: () => set((state) => {
        const next = !state.isNavigatorOpen;
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
        return { isNavigatorOpen: next };
    }),

    setNavigatorOpen: (open) => {
        try { localStorage.setItem(STORAGE_KEY, String(open)); } catch { /* ignore */ }
        set({ isNavigatorOpen: open });
    },

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
