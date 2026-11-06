import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

export interface ApiViewSliceState {
    /** Whether the conversation pane shows the session as API requests */
    isApiViewOpen: boolean;
}

export interface ApiViewSliceActions {
    toggleApiView: () => void;
}

export type ApiViewSlice = ApiViewSliceState & ApiViewSliceActions;

const STORAGE_KEY = "api-view-open";

export const createApiViewSlice: StateCreator<
    FullAppStore,
    [],
    [],
    ApiViewSlice
> = (set) => ({
    isApiViewOpen: (() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === "true";
        } catch {
            return false;
        }
    })(),

    toggleApiView: () => set((state) => {
        const next = !state.isApiViewOpen;
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
        return { isApiViewOpen: next };
    }),
});
