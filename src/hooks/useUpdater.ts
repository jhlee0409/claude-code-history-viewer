import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '@/utils/platform';
import {
  UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE,
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

/** The Update type from @tauri-apps/plugin-updater.
 *  Extracted via ReturnType to avoid a static import that breaks web mode. */
type Update = Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater')['check']>>;

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isRestarting: boolean;
  requiresManualRestart: boolean;
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
  requiresManualRestart: false,
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
    requiresManualRestart: false,
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
        requiresManualRestart: false,
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
        requiresManualRestart: false,
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
      requiresManualRestart: false,
      error: null,
    }));
    let contentLength = 0;
    let downloaded = 0;
    let startedEventSeen = false;
    let progressEventSeen = false;
    let finishedEventSeen = false;
    let downloadStepCompleted = false;

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
        await state.updateInfo.download(onDownloadEvent);
        downloadStepCompleted = true;
        setState((prev) => ({
          ...prev,
          isDownloading: false,
          isInstalling: true,
          downloadProgress: 100,
        }));
        await state.updateInfo.install();
      } else {
        await state.updateInfo.downloadAndInstall(onDownloadEvent);
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
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      const rawErrorMessage = getErrorMessage(error, 'Download failed');

      // Tauri v2: install() and relaunch() can fail due to upstream bugs
      // (known on macOS: tauri-apps/tauri#13923, #11392, #8472).
      // However, the downloaded payload IS applied on next manual app launch.
      const downloadCompleted = downloadStepCompleted || finishedEventSeen ||
        (contentLength > 0 && downloaded >= contentLength);

      if (downloadCompleted) {
        console.warn(
          '[Updater] Download completed but install/relaunch failed (known Tauri v2 macOS issue). Trying force-relaunch fallback.',
          error
        );

        // Second-chance: spawn OS-native helper that exits this process and
        // re-opens the new bundle. Bypasses Tauri's broken relaunch().
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('force_quit_and_relaunch');
          // Helper spawned + app.exit scheduled. Keep "isRestarting" UI shown
          // until the process actually exits.
          setState((prev) => ({
            ...prev,
            isDownloading: false,
            isInstalling: false,
            isRestarting: true,
            requiresManualRestart: false,
            error: null,
          }));
          return;
        } catch (fallbackError) {
          console.warn(
            '[Updater] force_quit_and_relaunch fallback failed; falling back to manual restart UX.',
            fallbackError
          );
        }
      } else {
        console.warn('[Updater] Download failed before completion.', {
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
        requiresManualRestart: downloadCompleted,
        error: downloadCompleted
          ? UPDATE_DOWNLOAD_COMPLETE_RESTART_CODE
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
      requiresManualRestart: false,
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
