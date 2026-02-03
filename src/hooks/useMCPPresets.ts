/**
 * MCP Preset Management Hook
 *
 * Provides functionality for managing MCP server presets
 * including saving, loading, and deleting presets.
 *
 * @deprecated This hook will be removed in v2.0. Use `useUnifiedPresets` instead,
 * which manages both settings and MCP server configurations in a single preset.
 *
 * @see {@link useUnifiedPresets} for the unified preset API that replaces this hook
 *
 * **Migration Guide:**
 * ```typescript
 * // Before:
 * const { presets, savePreset } = useMCPPresets();
 * await savePreset({ name: "My MCP", mcpServers: {...} });
 *
 * // After:
 * const { presets, savePreset } = useUnifiedPresets();
 * await savePreset({
 *   name: "My MCP",
 *   settings: null,  // or include settings
 *   mcpServers: {...}
 * });
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MCPPresetData, MCPPresetInput } from "../types/mcpPreset.types";

export interface UseMCPPresetsResult {
  // State
  presets: MCPPresetData[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadPresets: () => Promise<void>;
  savePreset: (input: MCPPresetInput) => Promise<MCPPresetData>;
  getPreset: (id: string) => Promise<MCPPresetData | null>;
  deletePreset: (id: string) => Promise<void>;
}

/**
 * Hook for managing MCP server presets
 *
 * @deprecated Use `useUnifiedPresets` instead. This hook will be removed in v2.0.
 * @see {@link useUnifiedPresets}
 */
export const useMCPPresets = (): UseMCPPresetsResult => {
  const [presets, setPresets] = useState<MCPPresetData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all MCP presets
  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedPresets = await invoke<MCPPresetData[]>("load_mcp_presets");
      setPresets(loadedPresets);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      console.error("Failed to load MCP presets:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save an MCP preset
  const savePreset = useCallback(
    async (input: MCPPresetInput): Promise<MCPPresetData> => {
      setIsLoading(true);
      setError(null);

      try {
        const savedPreset = await invoke<MCPPresetData>("save_mcp_preset", { input });
        await loadPresets(); // Reload list
        return savedPreset;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to save MCP preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
  );

  // Get a single MCP preset
  const getPreset = useCallback(
    async (id: string): Promise<MCPPresetData | null> => {
      setError(null);

      try {
        const preset = await invoke<MCPPresetData | null>("get_mcp_preset", { id });
        return preset;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to get MCP preset:", err);
        return null;
      }
    },
    []
  );

  // Delete an MCP preset
  const deletePreset = useCallback(
    async (id: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await invoke("delete_mcp_preset", { id });
        await loadPresets(); // Reload list
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to delete MCP preset:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadPresets]
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
  };
};
