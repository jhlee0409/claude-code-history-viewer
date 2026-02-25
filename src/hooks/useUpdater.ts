import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '@/utils/platform';
import {
  UPDATE_INSTALL_FAILED_ERROR_CODE,
  UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE,
} from '@/utils/updateError';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Update = any;

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
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

const WEB_INITIAL_STATE: UpdateState = {
  isChecking: false,
  hasUpdate: false,
  isDownloading: false,
  isInstalling: false,
  isRestarting: false,
  downloadProgress: 0,
  error: null,
  updateInfo: null,
  currentVersion: 'web',
  newVersion: null,
};

const WEB_NOOP_RETURN: UseUpdaterReturn = {
  state: WEB_INITIAL_STATE,
  checkForUpdates: () => Promise.resolve(null),
  downloadAndInstall: () => Promise.resolve(),
  dismissUpdate: () => {},
};

export function useUpdater(): UseUpdaterReturn {
  const tauriMode = isTauri();

  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    hasUpdate: false,
    isDownloading: false,
    isInstalling: false,
    isRestarting: false,
    downloadProgress: 0,
    error: null,
    updateInfo: null,
    currentVersion: tauriMode ? '' : 'web',
    newVersion: null,
  });

  // Load current version on mount (Tauri only)
  useEffect(() => {
    if (!tauriMode) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) =>
        getVersion()?.then((version: string) => {
          setState((prev) => ({ ...prev, currentVersion: version }));
        })
      )
      .catch(() => {
        /* version fetch is non-critical */
      });
  }, [tauriMode]);

  const checkForUpdates = useCallback(async (): Promise<Update | null> => {
    if (!tauriMode) return null;
    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const { check } = await import('@tauri-apps/plugin-updater');

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
  }, [tauriMode]);

  const downloadAndInstall = useCallback(async () => {
    if (!tauriMode || !state.updateInfo) return;

    setState((prev) => ({
      ...prev,
      isDownloading: true,
      isInstalling: false,
      isRestarting: false,
      error: null,
    }));
    let contentLength = 0;
    let downloaded = 0;
    let startedEventSeen = false;
    let progressEventSeen = false;
    let finishedEventSeen = false;
    let usedSeparateInstallFlow = false;
    let downloadStepCompleted = false;
    let installStepCompleted = false;
    let restartAttempted = false;

    try {
      const onDownloadEvent = (event: unknown) => {
        const eventType = String(
          (event as { event?: unknown })?.event ?? ''
        ).toLowerCase();

        switch (eventType) {
          case 'started': {
            startedEventSeen = true;
            contentLength = Number(
              (event as { data?: { contentLength?: unknown } })?.data?.contentLength ?? 0
            );
            downloaded = 0;
            finishedEventSeen = false;
            setState((prev) => ({ ...prev, downloadProgress: 0 }));
            break;
          }
          case 'progress': {
            progressEventSeen = true;
            const chunkLength = Number(
              (event as { data?: { chunkLength?: unknown } })?.data?.chunkLength ?? 0
            );
            if (Number.isFinite(chunkLength) && chunkLength > 0) {
              downloaded += chunkLength;
            }
            const progress =
              contentLength > 0
                ? Math.round((downloaded / contentLength) * 100)
                : 0;
            setState((prev) => ({ ...prev, downloadProgress: progress }));
            break;
          }
          case 'finished':
            finishedEventSeen = true;
            setState((prev) => ({
              ...prev,
              isDownloading: false,
              downloadProgress: 100,
            }));
            break;
        }
      };

      const hasSeparateInstallApi =
        typeof state.updateInfo.download === 'function' &&
        typeof state.updateInfo.install === 'function';

      if (hasSeparateInstallApi) {
        usedSeparateInstallFlow = true;
        await state.updateInfo.download(onDownloadEvent);
        downloadStepCompleted = true;
        setState((prev) => ({
          ...prev,
          isDownloading: false,
          isInstalling: true,
          downloadProgress: 100,
        }));
        await state.updateInfo.install();
        installStepCompleted = true;
      } else {
        await state.updateInfo.downloadAndInstall(onDownloadEvent);
        installStepCompleted = true;
      }

      // Show restarting state before relaunch
      setState((prev) => ({
        ...prev,
        isDownloading: false,
        isInstalling: false,
        isRestarting: true,
      }));

      // Brief delay to let the UI update before relaunch
      await new Promise((resolve) => setTimeout(resolve, 500));
      restartAttempted = true;
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      const rawErrorMessage = getErrorMessage(error, 'Download failed');
      const isGenericDownloadFailed = /^download failed$/i.test(
        rawErrorMessage.trim()
      );
      const shouldSuggestManualRestart = usedSeparateInstallFlow
        ? installStepCompleted || restartAttempted
        : installStepCompleted ||
          finishedEventSeen ||
          (isGenericDownloadFailed && (progressEventSeen || downloaded > 0));
      const shouldMapToInstallFailed =
        usedSeparateInstallFlow &&
        downloadStepCompleted &&
        !installStepCompleted &&
        isGenericDownloadFailed;

      if (shouldSuggestManualRestart) {
        console.warn(
          '[Updater] Update payload downloaded but automatic restart failed. Falling back to manual restart.',
          error
        );
      } else {
        console.warn('[Updater] downloadAndInstall failed before completion.', {
          rawErrorMessage,
          startedEventSeen,
          progressEventSeen,
          finishedEventSeen,
          downloaded,
          contentLength,
        });
      }

      setState((prev) => ({
        ...prev,
        isDownloading: false,
        isInstalling: false,
        isRestarting: false,
        error: shouldSuggestManualRestart
          ? UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE
          : shouldMapToInstallFailed
            ? UPDATE_INSTALL_FAILED_ERROR_CODE
            : rawErrorMessage,
      }));
    }
  }, [tauriMode, state.updateInfo]);

  const dismissUpdate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hasUpdate: false,
      updateInfo: null,
      newVersion: null,
      error: null,
    }));
  }, []);

  if (!tauriMode) {
    return WEB_NOOP_RETURN;
  }

  return {
    state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}
