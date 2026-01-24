/**
 * App Store
 *
 * Combined Zustand store using slice pattern.
 * Each slice manages a specific domain of the application state.
 */

import { create } from "zustand";
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
  CaptureModeSlice;

// ============================================================================
// Store Creation
// ============================================================================

export const useAppStore = create<AppStore>()((...args) => ({
  ...createProjectSlice(...args),
  ...createMessageSlice(...args),
  ...createSearchSlice(...args),
  ...createAnalyticsSlice(...args),
  ...createSettingsSlice(...args),
  ...createGlobalStatsSlice(...args),
  ...createMetadataSlice(...args),
  ...createCaptureModeSlice(...args),
}));
