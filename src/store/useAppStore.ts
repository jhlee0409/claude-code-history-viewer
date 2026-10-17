/**
 * App Store
 *
 * Combined Zustand store using slice pattern.
 * Each slice manages a specific domain of the application state.
 */

import { create } from "zustand";
import { registerWebUITabSource } from "@/utils/webuiDeepLink";
import { runUiStorageMigrations } from "@/navigation/storageMigration";
import {
  type ProjectSlice,
  createProjectSlice,
} from "./slices/projectSlice";
import {
  type MessageSlice,
  createMessageSlice,
} from "./slices/messageSlice";
import {
  type SearchSlice,
  createSearchSlice,
} from "./slices/searchSlice";
import {
  type AnalyticsSlice,
  createAnalyticsSlice,
} from "./slices/analyticsSlice";
import {
  type SettingsSlice,
  createSettingsSlice,
} from "./slices/settingsSlice";
import {
  type GlobalStatsSlice,
  createGlobalStatsSlice,
} from "./slices/globalStatsSlice";
import {
  type MetadataSlice,
  createMetadataSlice,
} from "./slices/metadataSlice";
import {
  type CaptureModeSlice,
  createCaptureModeSlice,
} from "./slices/captureModeSlice";
import {
  type BoardSlice,
  createBoardSlice,
} from "./slices/boardSlice";
import {
  type FilterSlice,
  createFilterSlice,
} from "./slices/filterSlice";
import {
  type NavigationSlice,
  createNavigationSlice,
} from "./slices/navigationSlice";
import {
  type WatcherSlice,
  createWatcherSlice,
} from "./slices/watcherSlice";
import {
  type NavigatorSlice,
  createNavigatorSlice,
} from "./slices/navigatorSlice";
import {
  type InspectorSlice,
  createInspectorSlice,
} from "./slices/inspectorSlice";
import {
  type MinimapSlice,
  createMinimapSlice,
} from "./slices/minimapSlice";
import {
  type RecentEditsPanelSlice,
  createRecentEditsPanelSlice,
} from "./slices/recentEditsPanelSlice";
import {
  type ProviderSlice,
  createProviderSlice,
} from "./slices/providerSlice";
import {
  type ArchiveSlice,
  createArchiveSlice,
} from "./slices/archiveSlice";
import {
  type SessionPickerSlice,
  createSessionPickerSlice,
} from "./slices/sessionPickerSlice";
import {
  type ServerSlice,
  createServerSlice,
} from "./slices/serverSlice";
import {
  type DocumentSlice,
  createDocumentSlice,
} from "./slices/documentSlice";
import {
  type SessionSelectionSlice,
  createSessionSelectionSlice,
} from "./slices/sessionSelectionSlice";

// Re-export types for backward compatibility
export type {
  SearchMatch,
  SearchFilterType,
  SearchState,
} from "./slices/types";

// ============================================================================
// Combined Store Type
// ============================================================================

export type AppStore = ProjectSlice &
  MessageSlice &
  SearchSlice &
  AnalyticsSlice &
  SettingsSlice &
  GlobalStatsSlice &
  MetadataSlice &
  CaptureModeSlice &
  BoardSlice &
  FilterSlice &
  NavigationSlice &
  WatcherSlice &
  NavigatorSlice &
  InspectorSlice &
  MinimapSlice &
  RecentEditsPanelSlice &
  ProviderSlice &
  ArchiveSlice &
  SessionPickerSlice &
  ServerSlice &
  SessionSelectionSlice &
  DocumentSlice;

// ============================================================================
// Store Creation
// ============================================================================

export const useAppStore = create<AppStore>()((...args) => {
  // Stored UI state from older versions is brought up to date before any
  // slice reads it (T9b: tabs.v1 → tabs.v2, the dock's keys removed).
  runUiStorageMigrations();
  return {
    ...createProjectSlice(...args),
    ...createMessageSlice(...args),
    ...createSearchSlice(...args),
    ...createAnalyticsSlice(...args),
    ...createSettingsSlice(...args),
    ...createGlobalStatsSlice(...args),
    ...createMetadataSlice(...args),
    ...createCaptureModeSlice(...args),
    ...createBoardSlice(...args),
    ...createFilterSlice(...args),
    ...createNavigationSlice(...args),
    ...createWatcherSlice(...args),
    ...createNavigatorSlice(...args),
    ...createInspectorSlice(...args),
    ...createMinimapSlice(...args),
    ...createRecentEditsPanelSlice(...args),
    ...createProviderSlice(...args),
    ...createArchiveSlice(...args),
    ...createSessionPickerSlice(...args),
    ...createServerSlice(...args),
    ...createSessionSelectionSlice(...args),
    ...createDocumentSlice(...args),
  };
});

// A WebUI URL that names a session also names the tab it is open in (F1).
registerWebUITabSource(() => useAppStore.getState().activeDocumentId);
