import { useState, useEffect, useCallback } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  downloadProgress: number;
  error: string | null;
  updateInfo: Update | null;
}

export interface UseNativeUpdaterReturn {
  state: UpdateState;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useNativeUpdater(): UseNativeUpdaterReturn {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    hasUpdate: false,
    isDownloading: false,
    isInstalling: false,
    downloadProgress: 0,
    error: null,
    updateInfo: null,
  });

  const checkForUpdates = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isChecking: true, error: null }));

      const update = await check();

      setState((prev) => ({
        ...prev,
        isChecking: false,
        hasUpdate: update?.available ?? false,
        updateInfo: update || null,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error:
          error instanceof Error
            ? error.message
            : t('common.error.updateCheckFailed', "Failed to check for updates"),
      }));
    }
  }, [t]);

  const downloadAndInstall = useCallback(async () => {
    if (!state.updateInfo) return;

    try {
      setState((prev) => ({ ...prev, isDownloading: true, error: null }));

      // 다운로드 진행률 리스너 (Tauri 업데이터 플러그인이 지원하는 경우)
      await state.updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setState((prev) => ({ ...prev, downloadProgress: 0 }));
            break;
          case "Progress":
            setState((prev) => ({
              ...prev,
              downloadProgress: Math.round(
                (event.data.chunkLength / (event.data.chunkLength || 1)) * 100
              ),
            }));
            break;
          case "Finished":
            setState((prev) => ({
              ...prev,
              isDownloading: false,
              isInstalling: true,
              downloadProgress: 100,
            }));
            break;
        }
      });

      // 설치 완료 후 앱 재시작
      await relaunch();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isDownloading: false,
        isInstalling: false,
        error:
          error instanceof Error
            ? error.message
            : t('common.error.updateInstallFailed', "Failed to install update"),
      }));
    }
  }, [state.updateInfo, t]);

  const dismissUpdate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hasUpdate: false,
      updateInfo: null,
      error: null,
    }));
  }, []);

  // 앱 시작 시 자동으로 업데이트 확인 (5초 후)
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates();
    }, 5000);

    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  return {
    state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}
