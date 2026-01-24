/**
 * Store Slices Index
 *
 * Re-exports all slice creators and types.
 */

// Types
export type {
  SearchMatch,
  SearchFilterType,
  SearchState,
} from "./types";
export { createEmptySearchState } from "./types";

// Project Slice
export type {
  ProjectSlice,
  ProjectSliceState,
  ProjectSliceActions,
} from "./projectSlice";
export { createProjectSlice, initialProjectState } from "./projectSlice";

// Message Slice
export type {
  MessageSlice,
  MessageSliceState,
  MessageSliceActions,
} from "./messageSlice";
export { createMessageSlice, initialMessageState } from "./messageSlice";

// Search Slice
export type {
  SearchSlice,
  SearchSliceState,
  SearchSliceActions,
} from "./searchSlice";
export { createSearchSlice, initialSearchState } from "./searchSlice";

// Analytics Slice
export type {
  AnalyticsSlice,
  AnalyticsSliceState,
  AnalyticsSliceActions,
} from "./analyticsSlice";
export {
  createAnalyticsSlice,
  initialAnalyticsSliceState,
} from "./analyticsSlice";

// Settings Slice
export type {
  SettingsSlice,
  SettingsSliceState,
  SettingsSliceActions,
} from "./settingsSlice";
export { createSettingsSlice, initialSettingsState } from "./settingsSlice";

// Global Stats Slice
export type {
  GlobalStatsSlice,
  GlobalStatsSliceState,
  GlobalStatsSliceActions,
} from "./globalStatsSlice";
export {
  createGlobalStatsSlice,
  initialGlobalStatsState,
} from "./globalStatsSlice";

// Metadata Slice
export type {
  MetadataSlice,
  MetadataSliceState,
  MetadataSliceActions,
} from "./metadataSlice";
export { createMetadataSlice, initialMetadataState } from "./metadataSlice";

// Capture Mode Slice
export type {
  CaptureModeSlice,
  CaptureModeSliceState,
  CaptureModeSliceActions,
} from "./captureModeSlice";
export {
  createCaptureModeSlice,
  initialCaptureModeState,
} from "./captureModeSlice";
