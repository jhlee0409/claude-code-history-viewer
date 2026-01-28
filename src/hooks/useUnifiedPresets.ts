/**
 * Unified Preset Management Hook
 *
 * Manages unified presets that combine settings.json and MCP server configs
 * into a single preset for complete configuration backup/restore.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  UnifiedPresetData,
  UnifiedPresetInput,
} from "../types/unifiedPreset";

export interface UseUnifiedPresetsResult {
  // State
  presets: UnifiedPresetData[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadPresets: () => Promise<void>;
  savePreset: (input: UnifiedPresetInput) => Promise<UnifiedPresetData>;
  getPreset: (id: string) => Promise<UnifiedPresetData | null>;
  deletePreset: (id: string) => Promise<void>;
  duplicatePreset: (id: string, newName: string) => Promise<UnifiedPresetData>;
}

/**
 * Hook for managing unified presets (settings + MCP servers combined)
 */
export const useUnifiedPresets = (): UseUnifiedPresetsResult => {
  const [presets, setPresets] = useState<UnifiedPresetData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all unified presets
  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedPresets =
        await invoke<UnifiedPresetData[]>("load_unified_presets");
      setPresets(loadedPresets);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      console.error("Failed to load unified presets:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save a unified preset
  const savePreset = useCallback(
    async (input: UnifiedPresetInput): Promise<UnifiedPresetData> => {
      setIsLoading(true);
      setError(null);

      try {
        const savedPreset = await invoke<UnifiedPresetData>(
          "save_unified_preset",
          { input }
        );
        await loadPresets(); // Reload list
        return savedPreset;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to save unified preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
  );

  // Get a single unified preset
  const getPreset = useCallback(
    async (id: string): Promise<UnifiedPresetData | null> => {
      setError(null);

      try {
        const preset = await invoke<UnifiedPresetData | null>(
          "get_unified_preset",
          { id }
        );
        return preset;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to get unified preset:", err);
        return null;
      }
    },
    []
  );

  // Delete a unified preset
  const deletePreset = useCallback(
    async (id: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await invoke("delete_unified_preset", { id });
        await loadPresets(); // Reload list
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to delete unified preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
  );

  // Duplicate a unified preset
  const duplicatePreset = useCallback(
    async (id: string, newName: string): Promise<UnifiedPresetData> => {
      setIsLoading(true);
      setError(null);

      try {
        const existing = await getPreset(id);
        if (!existing) {
          throw new Error("Preset not found");
        }

        const duplicateInput: UnifiedPresetInput = {
          name: newName,
          description: existing.description,
          settings: existing.settings,
          mcpServers: existing.mcpServers,
        };

        const savedPreset = await invoke<UnifiedPresetData>(
          "save_unified_preset",
          { input: duplicateInput }
        );
        await loadPresets();
        return savedPreset;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to duplicate unified preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getPreset, loadPresets]
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
    duplicatePreset,
  };
};
