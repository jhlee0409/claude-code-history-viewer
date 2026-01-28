/**
 * Preset Management Hook
 *
 * Provides functionality for managing user settings presets
 * including saving, loading, deleting, and applying presets.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PresetData, PresetInput } from "../types";
import { settingsToJson, jsonToSettings } from "../types";
import { useAppStore } from "../store/useAppStore";

export interface UsePresetsResult {
  // State
  presets: PresetData[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadPresets: () => Promise<void>;
  savePreset: (input: PresetInput) => Promise<PresetData>;
  getPreset: (id: string) => Promise<PresetData | null>;
  deletePreset: (id: string) => Promise<void>;
  applyPreset: (id: string) => Promise<void>;
  createPresetFromCurrentSettings: (
    name: string,
    description?: string
  ) => Promise<PresetData>;
}

/**
 * Hook for managing settings presets
 */
export const usePresets = (): UsePresetsResult => {
  const [presets, setPresets] = useState<PresetData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userSettings = useAppStore((state) => state.userMetadata.settings);
  const updateUserSettings = useAppStore((state) => state.updateUserSettings);

  // Load all presets
  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedPresets = await invoke<PresetData[]>("load_presets");
      setPresets(loadedPresets);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      console.error("Failed to load presets:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save a preset
  const savePreset = useCallback(
    async (input: PresetInput): Promise<PresetData> => {
      setIsLoading(true);
      setError(null);

      try {
        const savedPreset = await invoke<PresetData>("save_preset", { input });
        await loadPresets(); // Reload list
        return savedPreset;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to save preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
  );

  // Get a single preset
  const getPreset = useCallback(
    async (id: string): Promise<PresetData | null> => {
      setError(null);

      try {
        const preset = await invoke<PresetData | null>("get_preset", { id });
        return preset;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to get preset:", err);
        return null;
      }
    },
    []
  );

  // Delete a preset
  const deletePreset = useCallback(
    async (id: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await invoke("delete_preset", { id });
        await loadPresets(); // Reload list
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to delete preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
  );

  // Apply a preset (load and update user settings)
  const applyPreset = useCallback(
    async (id: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const preset = await getPreset(id);
        if (!preset) {
          throw new Error(`Preset not found: ${id}`);
        }

        const settings = jsonToSettings(preset.settings);
        await updateUserSettings(settings);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to apply preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getPreset, updateUserSettings]
  );

  // Create a preset from current settings
  const createPresetFromCurrentSettings = useCallback(
    async (name: string, description?: string): Promise<PresetData> => {
      const input: PresetInput = {
        name,
        description,
        settings: settingsToJson(userSettings),
      };

      return savePreset(input);
    },
    [userSettings, savePreset]
  );

  // Load presets on mount
  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  return {
    // State
    presets,
    isLoading,
    error,

    // Actions
    loadPresets,
    savePreset,
    getPreset,
    deletePreset,
    applyPreset,
    createPresetFromCurrentSettings,
  };
};

/**
 * Hook for preset selection state
 *
 * @param getPreset - Function to fetch a preset by ID (from usePresets hook)
 */
export const usePresetSelection = (
  getPreset: (id: string) => Promise<PresetData | null>
) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<PresetData | null>(null);

  const selectPreset = useCallback(
    async (id: string | null) => {
      setSelectedPresetId(id);
      if (id) {
        const preset = await getPreset(id);
        setSelectedPreset(preset);
      } else {
        setSelectedPreset(null);
      }
    },
    [getPreset]
  );

  return {
    selectedPresetId,
    selectedPreset,
    selectPreset,
  };
};
