import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import type { DateFilter } from "../../types/board.types";

export interface FilterSliceState {
    dateFilter: DateFilter;
    userOnlyFilter: boolean;
}

export interface FilterSliceActions {
    setDateFilter: (filter: DateFilter) => void;
    clearDateFilter: () => void;
    setUserOnlyFilter: (enabled: boolean) => void;
    toggleUserOnlyFilter: () => void;
}

export type FilterSlice = FilterSliceState & FilterSliceActions;

const getInitialDateFilter = () => ({ start: null, end: null });

const initialFilterState: FilterSliceState = {
    dateFilter: getInitialDateFilter(),
    userOnlyFilter: false,
};

export const createFilterSlice: StateCreator<
    FullAppStore,
    [],
    [],
    FilterSlice
> = (set) => ({
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
});
