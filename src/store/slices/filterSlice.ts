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
}

export interface MessageFilter {
    roles: MessageFilterRoles;
    contentTypes: MessageFilterContentTypes;
}

const DEFAULT_MESSAGE_FILTER: MessageFilter = {
    roles: { user: true, assistant: true },
    contentTypes: { text: true, thinking: true, toolCalls: true, commands: true },
};

export interface FilterSliceState {
    dateFilter: DateFilter;
    userOnlyFilter: boolean;
    messageFilter: MessageFilter;
}

export interface FilterSliceActions {
    setDateFilter: (filter: DateFilter) => void;
    clearDateFilter: () => void;
    setUserOnlyFilter: (enabled: boolean) => void;
    toggleUserOnlyFilter: () => void;
    toggleRole: (role: keyof MessageFilterRoles) => void;
    toggleContentType: (contentType: keyof MessageFilterContentTypes) => void;
    resetMessageFilter: () => void;
    isMessageFilterActive: () => boolean;
}

export type FilterSlice = FilterSliceState & FilterSliceActions;

const getInitialDateFilter = () => ({ start: null, end: null });

const initialFilterState: FilterSliceState = {
    dateFilter: getInitialDateFilter(),
    userOnlyFilter: false,
    messageFilter: { ...DEFAULT_MESSAGE_FILTER },
};

export const createFilterSlice: StateCreator<
    FullAppStore,
    [],
    [],
    FilterSlice
> = (set, get) => ({
    ...initialFilterState,

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

    toggleRole: (role) => {
        set((state) => ({
            messageFilter: {
                ...state.messageFilter,
                roles: {
                    ...state.messageFilter.roles,
                    [role]: !state.messageFilter.roles[role],
                },
            },
        }));
    },

    toggleContentType: (contentType) => {
        set((state) => ({
            messageFilter: {
                ...state.messageFilter,
                contentTypes: {
                    ...state.messageFilter.contentTypes,
                    [contentType]: !state.messageFilter.contentTypes[contentType],
                },
            },
        }));
    },

    resetMessageFilter: () => {
        set({
            messageFilter: {
                roles: { user: true, assistant: true },
                contentTypes: { text: true, thinking: true, toolCalls: true, commands: true },
            },
        });
    },

    isMessageFilterActive: () => {
        const { messageFilter } = get();
        const { roles, contentTypes } = messageFilter;
        return !roles.user || !roles.assistant
            || !contentTypes.text || !contentTypes.thinking
            || !contentTypes.toolCalls || !contentTypes.commands;
    },
});
