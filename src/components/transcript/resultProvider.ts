import { createContext, useContext } from "react";

/** Identity comes from the public message's provider, never sniffed from result keys. */
export const ResultProviderContext = createContext<string | undefined>(undefined);
export const useResultProvider = () => useContext(ResultProviderContext);

export const ResultSearchContext = createContext<{ searchQuery?: string; revealFor?: string; isCurrentMatch?: boolean; currentMatchIndex?: number }>({});
export const useResultSearch = () => useContext(ResultSearchContext);
