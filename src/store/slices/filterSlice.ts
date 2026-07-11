import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import type { DateFilter } from "../../types/board.types";

export interface MessageFilterRoles {
    user: boolean;
    assistant: boolean;
}

export interface MessageFilterContentTypes {
    text: boolean;
    thinking: boolean;
    toolCalls: boolean;
    commands: boolean;
    parallelTasks: boolean;
}

export interface MessageFilter {
    roles: MessageFilterRoles;
    contentTypes: MessageFilterContentTypes;
}

const MESSAGE_FILTER_STORAGE_KEY = "message-filter";

const defaultMessageFilter = (): MessageFilter => ({
    roles: { user: true, assistant: true },
    contentTypes: {
        text: true,
        thinking: true,
        toolCalls: true,
        commands: true,
        parallelTasks: true,
    },
});

const isBool = (value: unknown): value is boolean => typeof value === "boolean";

/**
 * Load the persisted message filter, validating every field. Any missing or
 * malformed field falls back to the default so an older/corrupt payload can never
 * break the toolbar. localStorage access is wrapped in try/catch per repo convention.
 */
const loadPersistedMessageFilter = (): MessageFilter => {
    const fallback = defaultMessageFilter();
    try {
        const raw = localStorage.getItem(MESSAGE_FILTER_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as Partial<MessageFilter> | null;
        const roles = parsed?.roles;
        const contentTypes = parsed?.contentTypes;
        if (!roles || !contentTypes) return fallback;
        return {
            roles: {
                user: isBool(roles.user) ? roles.user : fallback.roles.user,
                assistant: isBool(roles.assistant)
                    ? roles.assistant
                    : fallback.roles.assistant,
            },
            contentTypes: {
                text: isBool(contentTypes.text)
                    ? contentTypes.text
                    : fallback.contentTypes.text,
                thinking: isBool(contentTypes.thinking)
                    ? contentTypes.thinking
                    : fallback.contentTypes.thinking,
                toolCalls: isBool(contentTypes.toolCalls)
                    ? contentTypes.toolCalls
                    : fallback.contentTypes.toolCalls,
                commands: isBool(contentTypes.commands)
                    ? contentTypes.commands
                    : fallback.contentTypes.commands,
                parallelTasks: isBool(contentTypes.parallelTasks)
                    ? contentTypes.parallelTasks
                    : fallback.contentTypes.parallelTasks,
            },
        };
    } catch {
        return fallback;
    }
};

const persistMessageFilter = (filter: MessageFilter): void => {
    try {
        localStorage.setItem(MESSAGE_FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
        // Persistence is best-effort; ignore quota/availability failures.
    }
};

export interface FilterSliceState {
    dateFilter: DateFilter;
    userOnlyFilter: boolean;
    showParallelTasksInNavigator: boolean;
    messageFilter: MessageFilter;
}

export interface FilterSliceActions {
    setDateFilter: (filter: DateFilter) => void;
    clearDateFilter: () => void;
    setUserOnlyFilter: (enabled: boolean) => void;
    toggleUserOnlyFilter: () => void;
    setShowParallelTasksInNavigator: (enabled: boolean) => void;
    toggleShowParallelTasksInNavigator: () => void;
    toggleRole: (role: keyof MessageFilterRoles) => void;
    toggleContentType: (contentType: keyof MessageFilterContentTypes) => void;
    resetMessageFilter: () => void;
    isMessageFilterActive: () => boolean;
}

export type FilterSlice = FilterSliceState & FilterSliceActions;

const getInitialDateFilter = () => ({ start: null, end: null });

// A factory (not a const) so the persisted filter is read when the slice/store is
// created, not once at module import — keeps the load fresh on every store creation.
const initialFilterState = (): FilterSliceState => ({
    dateFilter: getInitialDateFilter(),
    userOnlyFilter: false,
    showParallelTasksInNavigator: true,
    // Seed from localStorage so the user's filter survives session switches and restarts.
    messageFilter: loadPersistedMessageFilter(),
});

export const createFilterSlice: StateCreator<
    FullAppStore,
    [],
    [],
    FilterSlice
> = (set, get) => ({
    ...initialFilterState(),

    setDateFilter: (dateFilter) => {
        set({ dateFilter });
    },

    clearDateFilter: () => {
        set({ dateFilter: { start: null, end: null } });
    },

    setUserOnlyFilter: (enabled) => {
        set({ userOnlyFilter: enabled });
    },

    toggleUserOnlyFilter: () => {
        set((state) => ({ userOnlyFilter: !state.userOnlyFilter }));
    },

    setShowParallelTasksInNavigator: (enabled) => {
        set({ showParallelTasksInNavigator: enabled });
    },

    toggleShowParallelTasksInNavigator: () => {
        set((state) => ({
            showParallelTasksInNavigator: !state.showParallelTasksInNavigator,
        }));
    },

    toggleRole: (role) => {
        const current = get().messageFilter;
        const next: MessageFilter = {
            ...current,
            roles: { ...current.roles, [role]: !current.roles[role] },
        };
        persistMessageFilter(next);
        set({ messageFilter: next });
    },

    toggleContentType: (contentType) => {
        const current = get().messageFilter;
        const next: MessageFilter = {
            ...current,
            contentTypes: {
                ...current.contentTypes,
                [contentType]: !current.contentTypes[contentType],
            },
        };
        persistMessageFilter(next);
        set({ messageFilter: next });
    },

    resetMessageFilter: () => {
        const next = defaultMessageFilter();
        persistMessageFilter(next);
        set({ messageFilter: next });
    },

    isMessageFilterActive: () => {
        const { messageFilter } = get();
        const { roles, contentTypes } = messageFilter;
        return !roles.user || !roles.assistant
            || !contentTypes.text || !contentTypes.thinking
            || !contentTypes.toolCalls || !contentTypes.commands
            || !contentTypes.parallelTasks;
    },
});
