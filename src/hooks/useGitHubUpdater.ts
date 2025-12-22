import { useState, useEffect, useCallback } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { getCachedUpdateResult, setCachedUpdateResult } from "../utils/updateCache";

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

export interface UpdateState {
  isChecking: boolean;
  hasUpdate: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  downloadProgress: number;
  error: string | null;
  updateInfo: Update | null;
  releaseInfo: GitHubRelease | null;
  currentVersion: string;
}

export interface UseGitHubUpdaterReturn {
  state: UpdateState;
  checkForUpdates: (forceCheck?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
}

export function useGitHubUpdater(): UseGitHubUpdaterReturn {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    hasUpdate: false,
    isDownloading: false,
    isInstalling: false,
    downloadProgress: 0,
    error: null,
    updateInfo: null,
    releaseInfo: null,
    currentVersion: "",
  });

  // 현재 버전 가져오기
  useEffect(() => {
    getVersion().then((version) => {
      setState((prev) => ({ ...prev, currentVersion: version }));
    });
  }, []);

  const fetchGitHubRelease =
    useCallback(async (): Promise<GitHubRelease | null> => {
      try {
        // AbortController로 타임아웃 제어 (10초)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(
          "https://api.github.com/repos/jhlee0409/claude-code-history-viewer/releases/latest",
          {
            method: "GET",
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "Claude-Code-History-Viewer",
            },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`GitHub API 오류: ${response.status}`);
        }

        const release = (await response.json()) as GitHubRelease;
        return release;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.warn("GitHub API 요청 타임아웃 (10초)");
        } else {
          console.error("GitHub 릴리즈 정보 가져오기 실패:", error);
        }
        return null;
      }
    }, []);

  const checkForUpdates = useCallback(async (forceCheck: boolean = false) => {
    try {
      setState((prev) => ({ ...prev, isChecking: true, error: null }));

      // 강제 체크가 아니면 캐시 확인
      if (!forceCheck && state.currentVersion) {
        const cached = getCachedUpdateResult(state.currentVersion);
        if (cached) {
          setState((prev) => ({
            ...prev,
            isChecking: false,
            hasUpdate: cached.hasUpdate,
            updateInfo: null, // Tauri 업데이트 객체는 캐시하지 않음
            releaseInfo: cached.releaseInfo,
          }));
          return;
        }
      }

      // GitHub API로 릴리즈 정보 가져오기
      const releaseInfo = await fetchGitHubRelease();

      if (!releaseInfo) {
        throw new Error("릴리즈 정보를 가져올 수 없습니다.");
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log('Release info:', releaseInfo);
      }

      // Tauri 업데이터로 업데이트 확인
      const update = await check();

      const hasUpdate = !!update;

      // 결과 캐싱 (현재 버전이 있을 때만)
      if (state.currentVersion) {
        setCachedUpdateResult(hasUpdate, releaseInfo, state.currentVersion);
      }

      setState((prev) => ({
        ...prev,
        isChecking: false,
        hasUpdate,
        updateInfo: update || null,
        releaseInfo,
      }));
    } catch (error) {
      console.error("업데이트 확인 실패:", error);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error:
          error instanceof Error
            ? error.message
            : "업데이트 확인 중 오류가 발생했습니다.",
      }));
    }
  }, [fetchGitHubRelease, state.currentVersion]);

  const downloadAndInstall = useCallback(async () => {
    if (!state.updateInfo) return;

    try {
      setState((prev) => ({ ...prev, isDownloading: true, error: null }));

      // 다운로드 진행률 추적을 위한 변수
      let contentLength = 0;
      let downloaded = 0;

      // 다운로드 진행률 리스너
      await state.updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            downloaded = 0;
            setState((prev) => ({ ...prev, downloadProgress: 0 }));
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const progress = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setState((prev) => ({ ...prev, downloadProgress: progress }));
            break;
          }
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
            : "업데이트 설치 중 오류가 발생했습니다.",
      }));
    }
  }, [state.updateInfo]);

  const dismissUpdate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hasUpdate: false,
      updateInfo: null,
      releaseInfo: null,
      error: null,
    }));
  }, []);

  // 자동 실행은 SmartUpdater에서 관리하므로 여기서는 제거

  return {
    state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}
