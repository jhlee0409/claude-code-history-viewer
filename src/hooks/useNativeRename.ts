import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isAbsolutePath } from "@/utils/pathUtils";
import type { ProviderId } from "@/types";

export interface NativeRenameResult {
  success: boolean;
  previous_title: string;
  new_title: string;
  file_path: string;
}

export interface UseNativeRenameReturn {
  isRenaming: boolean;
  error: string | null;
  renameNative: (
    filePath: string,
    newTitle: string,
    provider?: ProviderId
  ) => Promise<NativeRenameResult>;
  resetNativeName: (filePath: string, provider?: ProviderId) => Promise<NativeRenameResult>;
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
    async (
      filePath: string,
      newTitle: string,
      provider: ProviderId = "claude"
    ): Promise<NativeRenameResult> => {
      const normalizedTitle = newTitle.trim();

      if (provider === "opencode") {
        if (!filePath) {
          const errorMessage = "Invalid file path: path is required";
          setError(errorMessage);
          throw new Error(errorMessage);
        }

        setIsRenaming(true);
        setError(null);

        try {
          return await invoke<NativeRenameResult>("rename_opencode_session_title", {
            sessionPath: filePath,
            newTitle: normalizedTitle,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          throw new Error(errorMessage);
        } finally {
          setIsRenaming(false);
        }
      }

      if (provider !== "claude") {
        const errorMessage = `Native rename is not supported for provider: ${provider}`;
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      // Validate absolute path before calling Claude backend command
      if (!filePath || !isAbsolutePath(filePath)) {
        const errorMessage = "Invalid file path: must be an absolute path";
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      setIsRenaming(true);
      setError(null);

      try {
        const result = await invoke<NativeRenameResult>("rename_session_native", {
          filePath,
          newTitle: normalizedTitle,
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
    async (
      filePath: string,
      provider: ProviderId = "claude"
    ): Promise<NativeRenameResult> => {
      return renameNative(filePath, "", provider);
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
