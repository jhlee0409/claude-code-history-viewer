import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "@tauri-apps/plugin-http";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { getCachedUpdateResult, setCachedUpdateResult } from "../utils/updateCache";

// Configuration constants
const REPO_OWNER = 'jhlee0409';
const REPO_NAME = 'claude-code-history-viewer';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const GITHUB_RELEASE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag`;
const API_TIMEOUT_MS = 10000;

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
  const { t } = useTranslation();
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

        const response = await fetch(GITHUB_API_URL, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Claude-Code-History-Viewer",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(t('common.hooks.githubApiError', { status: response.status }));
        }

        const release = (await response.json()) as GitHubRelease;
        return release;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.warn(`GitHub API request timeout (${API_TIMEOUT_MS}ms)`);
        } else {
          console.error("Failed to fetch GitHub release info:", error);
        }
        return null;
      }
    }, [t]);

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

      // Tauri 업데이터로 업데이트 확인 (핵심 - 먼저 실행)
      const update = await check();
      const hasUpdate = !!update;

      // GitHub API로 릴리즈 정보 가져오기 (실패해도 업데이트 체크는 계속)
      let releaseInfo: GitHubRelease | null = null;
      try {
        releaseInfo = await fetchGitHubRelease();
        if (process.env.NODE_ENV === 'development') {
          console.log('Release info:', releaseInfo);
        }
      } catch (e) {
        // GitHub API 실패해도 Tauri updater 결과는 사용
        console.warn('GitHub API 실패, Tauri updater 결과만 사용:', e);
      }

      // 릴리즈 정보가 없으면 업데이트 버전으로 대체 생성
      if (!releaseInfo && update) {
        releaseInfo = {
          tag_name: `v${update.version}`,
          name: `v${update.version}`,
          body: '',
          published_at: new Date().toISOString(),
          html_url: `${GITHUB_RELEASE_URL}/v${update.version}`,
          assets: [],
        };
      }

      // 결과 캐싱 (현재 버전이 있을 때만)
      if (state.currentVersion && releaseInfo) {
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
            : t('common.hooks.updateCheckFailed'),
      }));
    }
  }, [fetchGitHubRelease, state.currentVersion, t]);

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
            : t('common.hooks.updateInstallFailed'),
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
