/**
 * @deprecated This file is deprecated. Import from '@/types' or '@/types/derived/preset' instead.
 *
 * Settings preset types for saving and loading user configurations
 *
 * This module contains data structures for settings presets
 * that allow users to save and quickly switch between different configurations.
 * Location: ~/.claude-history-viewer/presets/
 *
 * @see src/types/derived/preset.ts for the unified implementation
 */

import type { UserSettings } from "./metadata.types";

/** Data structure for a settings preset */
export interface PresetData {
  /** Unique identifier for the preset */
  id: string;
  /** Display name for the preset */
  name: string;
  /** Optional description of the preset */
  description?: string;
  /** JSON string of UserSettings */
  settings: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/** Input structure for creating/updating presets */
export interface PresetInput {
  /** Optional ID (auto-generated if not provided) */
  id?: string;
  /** Display name for the preset */
  name: string;
  /** Optional description of the preset */
  description?: string;
  /** JSON string of UserSettings */
  settings: string;
}

/** Helper to convert UserSettings to JSON string */
export const settingsToJson = (settings: UserSettings): string => {
  return JSON.stringify(settings);
};

/** Helper to parse settings JSON string */
export const jsonToSettings = (json: string): UserSettings => {
  return JSON.parse(json) as UserSettings;
};

/** Helper to create preset input from UserSettings */
export const createPresetInput = (
  name: string,
  settings: UserSettings,
  description?: string,
  id?: string
): PresetInput => {
  return {
    id,
    name,
    description,
    settings: settingsToJson(settings),
  };
};

/** Helper to extract settings from preset data */
export const extractSettings = (preset: PresetData): UserSettings => {
  return jsonToSettings(preset.settings);
};

/** Helper to format preset timestamp for display */
export const formatPresetDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
