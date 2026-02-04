import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NativeRenameResult {
  success: boolean;
  previous_title: string;
  new_title: string;
  file_path: string;
}

export interface UseNativeRenameReturn {
  isRenaming: boolean;
  error: string | null;
  renameNative: (filePath: string, newTitle: string) => Promise<NativeRenameResult>;
  resetNativeName: (filePath: string) => Promise<NativeRenameResult>;
}

/**
 * Hook for native Claude Code session renaming operations.
 *
 * This hook provides functionality to rename sessions at the file level,
 * making the rename visible in Claude Code CLI.
 *
 * @example
 * ```tsx
 * const { renameNative, isRenaming, error } = useNativeRename();
 *
 * const handleRename = async () => {
 *   try {
 *     const result = await renameNative(session.file_path, "My New Title");
 *     toast.success(`Renamed: ${result.new_title}`);
 *   } catch (err) {
 *     toast.error(`Failed: ${err}`);
 *   }
 * };
 * ```
 */
export const useNativeRename = (): UseNativeRenameReturn => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renameNative = useCallback(
    async (filePath: string, newTitle: string): Promise<NativeRenameResult> => {
      setIsRenaming(true);
      setError(null);

      try {
        const result = await invoke<NativeRenameResult>("rename_session_native", {
          filePath,
          newTitle: newTitle.trim(),
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setIsRenaming(false);
      }
    },
    []
  );

  const resetNativeName = useCallback(
    async (filePath: string): Promise<NativeRenameResult> => {
      return renameNative(filePath, "");
    },
    [renameNative]
  );

  return {
    isRenaming,
    error,
    renameNative,
    resetNativeName,
  };
};
