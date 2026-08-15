import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import {
    type WebUINavigationOptions,
    writeWebUIDeepLink,
} from "@/utils/webuiDeepLink";

export interface NavigationSliceState {
    targetMessageUuid: string | null;
    shouldHighlightTarget: boolean;
}

export interface NavigationSliceActions {
    navigateToMessage: (uuid: string, options?: WebUINavigationOptions) => void;
    clearTargetMessage: () => void;
}

export type NavigationSlice = NavigationSliceState & NavigationSliceActions;

export const createNavigationSlice: StateCreator<
    FullAppStore,
    [],
    [],
    NavigationSlice
> = (set, get) => ({
    targetMessageUuid: null,
    shouldHighlightTarget: false,

    navigateToMessage: (uuid, options) => {
        set({
            targetMessageUuid: uuid,
            shouldHighlightTarget: true
        });

        const session = get().selectedSession;
        const sessionId = session?.actual_session_id || session?.session_id;
        if (sessionId) {
            writeWebUIDeepLink(
                { sessionId, messageId: uuid },
                options?.history ?? "push",
            );
        }
    },

    clearTargetMessage: () => set({
        targetMessageUuid: null,
        shouldHighlightTarget: false
    })
});
