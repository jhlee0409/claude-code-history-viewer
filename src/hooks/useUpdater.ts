import { useState, useEffect, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

const CHECK_TIMEOUT_MS = 20_000; // 20 seconds

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  error: string | null;
  updateInfo: Update | null;
  currentVersion: string;
  newVersion: string | null;
}

export interface UseUpdaterReturn {
  state: UpdateState;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    hasUpdate: false,
    isDownloading: false,
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

  const checkForUpdates = useCallback(async () => {
    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      // Race between check and timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Update check timeout')), CHECK_TIMEOUT_MS);
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
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: error instanceof Error ? error.message : 'Update check failed',
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!state.updateInfo) return;

    setState((prev) => ({ ...prev, isDownloading: true, error: null }));

    try {
      let contentLength = 0;
      let downloaded = 0;

      await state.updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            downloaded = 0;
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
            setState((prev) => ({
              ...prev,
              isDownloading: false,
              downloadProgress: 100,
            }));
            break;
        }
      });

      await relaunch();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isDownloading: false,
        error: error instanceof Error ? error.message : 'Download failed',
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
