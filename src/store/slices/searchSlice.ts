/**
 * Search Slice
 *
 * Handles global search and session search (KakaoTalk-style navigation).
 */

import { api } from "@/services/api";
import { toast } from "sonner";
import type { ClaudeMessage, SearchFilters } from "../../types";
import { AppErrorType } from "../../types";
import type { StateCreator } from "zustand";
import { searchMessagesAsync, buildSearchIndex, isSearchIndexReady, linearSearchMessages } from "../../utils/searchIndex";
import {
  type SearchState,
  type SearchFilterType,
  type SearchMatch,
  type FullAppStore,
  createEmptySearchState,
} from "./types";
import { hasNonDefaultProvider } from "../../utils/providers";

// ============================================================================
// State Interface
// ============================================================================

export interface SearchSliceState {
  // Global search
  searchQuery: string;
  searchResults: ClaudeMessage[];
  searchFilters: SearchFilters;
  // Session search
  sessionSearch: SearchState;
}

export interface SearchSliceActions {
  // Global search
  searchMessages: (query: string, filters?: SearchFilters) => Promise<void>;
  setSearchFilters: (filters: SearchFilters) => void;
  // Session search
  setSessionSearchQuery: (query: string) => Promise<void> | void;
  setSearchFilterType: (filterType: SearchFilterType) => void;
  goToNextMatch: () => void;
  goToPrevMatch: () => void;
  goToMatchIndex: (index: number) => void;
  clearSessionSearch: () => void;
}

export type SearchSlice = SearchSliceState & SearchSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialSearchState: SearchSliceState = {
  searchQuery: "",
  searchResults: [],
  searchFilters: {},
  sessionSearch: {
    query: "",
    matches: [],
    currentMatchIndex: -1,
    isSearching: false,
    filterType: "content" as SearchFilterType,
    results: [],
  },
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createSearchSlice: StateCreator<
  FullAppStore,
  [],
  [],
  SearchSlice
> = (set, get) => {
  // Monotonic request token for setSessionSearchQuery: protects against
  // stale async results overwriting newer ones when the user types quickly
  // and the Worker is still building (linear fallback is sync, Worker path
  // is async - earlier async result can otherwise land on top of a later
  // sync result).
  let sessionSearchRequestId = 0;

  return {
  ...initialSearchState,

  // Global search
  searchMessages: async (query: string, filters: SearchFilters = {}) => {
    const { claudePath, activeProviders } = get();
    const hasNonClaudeProviders = hasNonDefaultProvider(activeProviders);

    if (!query.trim() || (!claudePath && !hasNonClaudeProviders)) {
      set({ searchResults: [], searchQuery: "" });
      return;
    }

    set({ searchQuery: query });
    try {
      const customClaudePaths = get().userMetadata?.settings?.customClaudePaths;
      const hasCustomPaths = customClaudePaths != null && customClaudePaths.length > 0;
      const settings = get().userMetadata?.settings;
      const wslEnabled = settings?.wsl?.enabled ?? false;
      const results = (hasNonClaudeProviders || hasCustomPaths || wslEnabled)
        ? await api<ClaudeMessage[]>("search_all_providers", {
            claudePath,
            query,
            activeProviders,
            filters,
            customClaudePaths: hasCustomPaths ? customClaudePaths : undefined,
            wslEnabled,
            wslExcludedDistros: settings?.wsl?.excludedDistros ?? [],
          })
        : await api<ClaudeMessage[]>("search_messages", {
            claudePath,
            query,
            filters,
          });
      set({ searchResults: results });
    } catch (error) {
      console.error("Failed to search messages:", error);
      get().setError({ type: AppErrorType.UNKNOWN, message: String(error) });
    }
  },

  setSearchFilters: (filters: SearchFilters) => {
    set({ searchFilters: filters });
  },

  // Session search (KakaoTalk-style navigation)
  setSessionSearchQuery: async (query: string) => {
    const requestId = ++sessionSearchRequestId;
    const { sessionSearch } = get();
    const { filterType } = sessionSearch;
    const sessionPath = get().selectedSession?.file_path;

    // Empty query clears search results
    if (!query.trim()) {
      set((state) => ({
        sessionSearch: createEmptySearchState(state.sessionSearch.filterType),
      }));
      return;
    }

    // Set searching state
    set((state) => ({
      sessionSearch: {
        ...state.sessionSearch,
        query,
        isSearching: true,
      },
    }));

    // Helper: predicate "this request is still the latest one AND the user
    // is still on the session it was issued for". Re-checked after EVERY
    // await and in the catch path — a session switch does not bump the
    // request id, so the id alone cannot stop a stale result (or a stale
    // error) from landing on the new session's state.
    const isStillLatest = () =>
      requestId === sessionSearchRequestId &&
      get().selectedSession?.file_path === sessionPath;

    try {
      // Search over the COMPLETE session, not just the loaded window —
      // matches in unloaded older pages must be findable. The fetch is
      // cached per session in the message slice.
      const searchableMessages = await get().fetchFullSessionMessages();

      // Session-switch guard: the full fetch resolved for a session the
      // user has already left.
      if (!isStillLatest()) {
        return;
      }

      // Search strategy: Worker (async) > linear fallback (sync)
      let searchResults: Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }>;

      if (isSearchIndexReady()) {
        // Worker index is ready — use fast async search
        searchResults = await searchMessagesAsync(query, filterType);
      } else {
        // Index not ready — use linear search (instant, ~100-200ms for 50k messages)
        searchResults = linearSearchMessages(searchableMessages, query, filterType);
        // Trigger background Worker index build for future searches
        buildSearchIndex(searchableMessages);
      }

      // Drop stale results: a newer search has been started while this one
      // was awaiting. The newer search owns `isSearching` and will clear it
      // on its own success / failure path, so we intentionally do not touch
      // it here.
      if (!isStillLatest()) return;

      // Convert to SearchMatch format (filter valid indices)
      const matches: SearchMatch[] = searchResults
        .filter(
          (result) =>
            result.messageIndex >= 0 &&
            result.messageIndex < searchableMessages.length
        )
        .map((result) => ({
          messageUuid: result.messageUuid,
          messageIndex: result.messageIndex,
          matchIndex: result.matchIndex,
          matchCount: result.matchCount,
        }));

      // Save match results (auto-navigate to first match)
      set((state) => ({
        sessionSearch: {
          query,
          matches,
          currentMatchIndex: matches.length > 0 ? 0 : -1,
          isSearching: false,
          filterType: state.sessionSearch.filterType,
          results: matches
            .map((m) => searchableMessages[m.messageIndex])
            .filter((m): m is ClaudeMessage => m !== undefined),
        },
      }));
    } catch (error) {
      console.error("[Search] Failed to search messages:", error);
      // Drop stale error: a newer search has already started and owns
      // the `isSearching` state.
      if (!isStillLatest()) return;
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to search messages: ${message}`);
      set((state) => ({
        sessionSearch: {
          query,
          matches: [],
          currentMatchIndex: -1,
          isSearching: false,
          filterType: state.sessionSearch.filterType,
          results: [],
        },
      }));
    }
  },

  goToNextMatch: () => {
    const { sessionSearch } = get();
    if (sessionSearch.matches.length === 0) return;

    const nextIndex =
      (sessionSearch.currentMatchIndex + 1) % sessionSearch.matches.length;
    set({
      sessionSearch: {
        ...sessionSearch,
        currentMatchIndex: nextIndex,
      },
    });
  },

  goToPrevMatch: () => {
    const { sessionSearch } = get();
    if (sessionSearch.matches.length === 0) return;

    const totalMatches = sessionSearch.matches.length;
    const prevIndex =
      sessionSearch.currentMatchIndex <= 0
        ? totalMatches - 1
        : sessionSearch.currentMatchIndex - 1;

    set({
      sessionSearch: {
        ...sessionSearch,
        currentMatchIndex: prevIndex,
      },
    });
  },

  goToMatchIndex: (index: number) => {
    const { sessionSearch } = get();
    const { matches } = sessionSearch;

    if (index < 0 || index >= matches.length) {
      console.warn(
        `[Search] Invalid match index: ${index} (total: ${matches.length})`
      );
      return;
    }

    set({
      sessionSearch: {
        ...sessionSearch,
        currentMatchIndex: index,
      },
    });
  },

  clearSessionSearch: () => {
    set((state) => ({
      sessionSearch: createEmptySearchState(state.sessionSearch.filterType),
    }));
  },

  setSearchFilterType: (filterType: SearchFilterType) => {
    set(() => ({
      sessionSearch: createEmptySearchState(filterType),
    }));
  },
  };
};
