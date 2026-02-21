import { useState, useEffect, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE } from '@/utils/updateError';

const CHECK_TIMEOUT_MS = 20_000; // 20 seconds

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    (error as { message: string }).message.trim().length > 0
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  isDownloading: boolean;
  isRestarting: boolean;
  downloadProgress: number;
  error: string | null;
  updateInfo: Update | null;
  currentVersion: string;
  newVersion: string | null;
}

export interface UseUpdaterReturn {
  state: UpdateState;
  checkForUpdates: () => Promise<Update | null>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    hasUpdate: false,
    isDownloading: false,
    isRestarting: false,
    downloadProgress: 0,
    error: null,
    updateInfo: null,
    currentVersion: '',
    newVersion: null,
  });

  // Load current version on mount
  useEffect(() => {
    getVersion().then((version) => {
      setState((prev) => ({ ...prev, currentVersion: version }));
    });
  }, []);

  const checkForUpdates = useCallback(async (): Promise<Update | null> => {
    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Race between check and timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Update check timeout')),
          CHECK_TIMEOUT_MS
        );
      });

      const update = await Promise.race([
        check({ timeout: CHECK_TIMEOUT_MS }),
        timeoutPromise,
      ]);

      setState((prev) => ({
        ...prev,
        isChecking: false,
        hasUpdate: !!update,
        updateInfo: update,
        newVersion: update?.version ?? null,
      }));

      return update ?? null;
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Update check failed');
      setState((prev) => ({
        ...prev,
        isChecking: false,
        hasUpdate: false,
        updateInfo: null,
        newVersion: null,
        error: errorMessage,
      }));

      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!state.updateInfo) return;

    setState((prev) => ({ ...prev, isDownloading: true, error: null }));
    let finishedEventSeen = false;
    let installStepCompleted = false;

    try {
      let contentLength = 0;
      let downloaded = 0;

      await state.updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            downloaded = 0;
            finishedEventSeen = false;
            setState((prev) => ({ ...prev, downloadProgress: 0 }));
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength;
            const progress = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setState((prev) => ({ ...prev, downloadProgress: progress }));
            break;
          }
          case 'Finished':
            finishedEventSeen = true;
            setState((prev) => ({
              ...prev,
              isDownloading: false,
              isRestarting: true,
              downloadProgress: 100,
            }));
            break;
        }
      });
      installStepCompleted = true;

      // Show restarting state before relaunch
      setState((prev) => ({ ...prev, isDownloading: false, isRestarting: true }));

      // Brief delay to let the UI update before relaunch
      await new Promise((resolve) => setTimeout(resolve, 500));
      await relaunch();
    } catch (error) {
      const rawErrorMessage = getErrorMessage(error, 'Download failed');
      const shouldSuggestManualRestart =
        installStepCompleted ||
        (finishedEventSeen && /download failed/i.test(rawErrorMessage));

      if (shouldSuggestManualRestart) {
        console.warn(
          '[Updater] Update payload downloaded but automatic restart failed. Falling back to manual restart.',
          error
        );
      }

      setState((prev) => ({
        ...prev,
        isDownloading: false,
        isRestarting: false,
        error: shouldSuggestManualRestart
          ? UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE
          : rawErrorMessage,
      }));
    }
  }, [state.updateInfo]);

  const dismissUpdate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hasUpdate: false,
      updateInfo: null,
      newVersion: null,
      error: null,
    }));
  }, []);

  return {
    state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}
