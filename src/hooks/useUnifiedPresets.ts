/**
 * Unified Preset Management Hook
 *
 * **PRIMARY PRESET API** - Use this hook for all preset operations.
 *
 * Manages unified presets that combine settings.json and MCP server configs
 * into a single preset for complete configuration backup/restore. This is the
 * single source of truth for preset management in the application.
 *
 * @example Basic Usage
 * ```typescript
 * const { presets, savePreset, deletePreset, isLoading } = useUnifiedPresets();
 *
 * // Save a new preset
 * const newPreset = await savePreset({
 *   name: "Production Setup",
 *   description: "MCP + dark theme settings",
 *   settings: currentSettings,    // User settings from useAppStore
 *   mcpServers: currentMCPServers  // MCP configs from useMCPServers
 * });
 * ```
 *
 * @example Settings-Only Preset
 * ```typescript
 * await savePreset({
 *   name: "Dark Theme",
 *   settings: { theme: "dark", ... },
 *   mcpServers: null  // No MCP servers
 * });
 * ```
 *
 * @example MCP-Only Preset
 * ```typescript
 * await savePreset({
 *   name: "Dev MCP Servers",
 *   settings: null,   // No settings
 *   mcpServers: { "server-1": {...}, "server-2": {...} }
 * });
 * ```
 *
 * @example Duplicate with Modifications
 * ```typescript
 * const original = await getPreset("preset-123");
 * const duplicated = await duplicatePreset("preset-123", "Modified Setup");
 * ```
 *
 * @remarks
 * **Replaces Legacy Hooks:**
 * - `usePresets` (settings-only presets) - deprecated, remove in v2.0
 * - `useMCPPresets` (MCP-only presets) - deprecated, remove in v2.0
 *
 * **State Management:**
 * - Auto-loads presets on mount
 * - Reloads after mutations (save/delete/duplicate)
 * - Error handling with user-facing messages
 *
 * **Backend Integration:**
 * - Rust commands: `load_unified_presets`, `save_unified_preset`, etc.
 * - Storage: `~/.claude/presets/unified/`
 * - Format: JSON files with UUID-based filenames
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  UnifiedPresetData,
  UnifiedPresetInput,
} from "../types/unifiedPreset";

export interface UseUnifiedPresetsResult {
  // State
  /** All unified presets loaded from storage */
  presets: UnifiedPresetData[];
  /** Loading state for async operations */
  isLoading: boolean;
  /** Error message from last failed operation, null if no error */
  error: string | null;

  // Actions
  /** Load all presets from backend storage */
  loadPresets: () => Promise<void>;
  /**
   * Save a new preset or update an existing one
   * @param input - Preset data (name, description, settings, mcpServers)
   * @returns The saved preset with generated ID and timestamps
   * @throws Error if save operation fails
   */
  savePreset: (input: UnifiedPresetInput) => Promise<UnifiedPresetData>;
  /**
   * Get a single preset by ID
   * @param id - Preset UUID
   * @returns The preset if found, null otherwise
   */
  getPreset: (id: string) => Promise<UnifiedPresetData | null>;
  /**
   * Delete a preset by ID
   * @param id - Preset UUID to delete
   * @throws Error if delete operation fails
   */
  deletePreset: (id: string) => Promise<void>;
  /**
   * Duplicate an existing preset with a new name
   * @param id - Source preset UUID
   * @param newName - Name for the duplicated preset
   * @returns The new preset with different ID and timestamps
   * @throws Error if source preset not found or save fails
   */
  duplicatePreset: (id: string, newName: string) => Promise<UnifiedPresetData>;
}

/**
 * Hook for managing unified presets (settings + MCP servers combined)
 *
 * @returns Preset state and management functions
 *
 * @see {@link UnifiedPresetData} for the preset data structure
 * @see {@link UnifiedPresetInput} for the input structure when saving
 */
export const useUnifiedPresets = (): UseUnifiedPresetsResult => {
  const [presets, setPresets] = useState<UnifiedPresetData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load all unified presets from backend storage
   *
   * Clears any previous errors and reloads the complete preset list.
   * Called automatically on mount and after mutations.
   */
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

  /**
   * Save a unified preset (create new or update existing)
   *
   * Automatically reloads the preset list after successful save to ensure
   * UI consistency. The backend generates a UUID if not provided.
   *
   * @param input - Preset input with name, description, settings, mcpServers
   * @returns The saved preset with full metadata (id, createdAt, updatedAt)
   * @throws Propagates backend errors (validation, storage failures)
   */
  const savePreset = useCallback(
    async (input: UnifiedPresetInput): Promise<UnifiedPresetData> => {
      setIsLoading(true);
      setError(null);

      try {
        const savedPreset = await invoke<UnifiedPresetData>(
          "save_unified_preset",
          { input }
        );
        await loadPresets(); // Reload list to reflect backend state
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

  /**
   * Get a single unified preset by ID
   *
   * Fetches directly from backend storage without modifying state.
   * Does not trigger loading state (fast read operation).
   *
   * @param id - Preset UUID
   * @returns The preset if found, null if not found or error occurred
   */
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

  /**
   * Delete a unified preset by ID
   *
   * Removes the preset file from backend storage and reloads the list.
   *
   * @param id - Preset UUID to delete
   * @throws Propagates backend errors (file not found, permission denied)
   */
  const deletePreset = useCallback(
    async (id: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await invoke("delete_unified_preset", { id });
        await loadPresets(); // Reload list to remove deleted item from UI
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

  /**
   * Duplicate an existing preset with a new name
   *
   * Creates a new preset by copying all data from the source preset
   * (description, settings, mcpServers) with only the name changed.
   * The new preset gets a fresh UUID and timestamps.
   *
   * @param id - Source preset UUID to duplicate
   * @param newName - Name for the new preset
   * @returns The newly created preset with different ID
   * @throws Error if source preset not found or save operation fails
   *
   * @example
   * ```typescript
   * const duplicated = await duplicatePreset(
   *   "abc-123",
   *   "Production Setup (Copy)"
   * );
   * console.log(duplicated.id); // New UUID, different from "abc-123"
   * ```
   */
  const duplicatePreset = useCallback(
    async (id: string, newName: string): Promise<UnifiedPresetData> => {
      setIsLoading(true);
      setError(null);

      try {
        const existing = await getPreset(id);
        if (!existing) {
          throw new Error(`Preset not found: ${id}`);
        }

        // Create new preset with copied data
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
        await loadPresets(); // Reload to show new preset in list
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

  /**
   * Auto-load presets on mount
   *
   * Ensures preset list is populated when the hook is first used.
   * loadPresets is memoized with useCallback, so this effect runs once.
   */
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
