import { useState, useEffect, useCallback } from 'react';
import { useGitHubUpdater } from './useGitHubUpdater';
import {
  getUpdateSettings,
  shouldCheckForUpdates,
  shouldShowUpdateForVersion,
  isOnline
} from '@/utils/updateSettings';

// Timing constants (in milliseconds)
const INTRO_MODAL_DELAY_MS = 2000;
const AUTO_CHECK_DELAY_MS = 5000;
const POST_INTRO_CHECK_DELAY_MS = 1000;

export function useSmartUpdater() {
  const githubUpdater = useGitHubUpdater();
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [introModalShown, setIntroModalShown] = useState(false);

  // 초기 안내 모달 표시 확인
  useEffect(() => {
    const settings = getUpdateSettings();
    if (!settings.hasSeenIntroduction && !introModalShown) {
      // 앱 시작 후 잠시 후에 안내 모달 표시 (UX 개선)
      const timer = setTimeout(() => {
        setShowIntroModal(true);
        setIntroModalShown(true);
      }, INTRO_MODAL_DELAY_MS);

      return () => clearTimeout(timer);
    }
  }, [introModalShown]);

  // 스마트 업데이트 체크
  const smartCheckForUpdates = useCallback(async (forceCheck = false) => {
    // 강제 체크가 아닐 때 조건 확인
    if (!forceCheck) {
      // 오프라인 상태 확인
      if (!isOnline()) {
        console.log('오프라인 상태로 업데이트 체크 건너뜀');
        return;
      }

      // 사용자 설정 확인
      if (!shouldCheckForUpdates()) {
        console.log('사용자 설정에 의해 업데이트 체크 건너뜀');
        return;
      }
    }

    await githubUpdater.checkForUpdates(forceCheck);
  }, [githubUpdater]);

  // 자동 체크 (개선된 버전)
  useEffect(() => {
    // 개발 모드에서는 자동 업데이트 체크 비활성화 (GitHub API rate limit 방지)
    if (import.meta.env.DEV) {
      console.log('[DEV] 자동 업데이트 체크 비활성화');
      return;
    }

    const settings = getUpdateSettings();

    // 자동 체크가 비활성화되어 있으면 체크하지 않음
    if (!settings.autoCheck) {
      return;
    }

    // 체크 주기에 따른 처리 (never인 경우 조기 반환)
    if (settings.checkInterval === 'never') {
      return;
    }

    // TODO: daily/weekly 체크 시 마지막 체크 시간과 비교하여 실제 주기 적용
    // 현재는 모든 interval에서 동일한 지연 시간 사용
    const delay = AUTO_CHECK_DELAY_MS;

    const timer = setTimeout(() => {
      smartCheckForUpdates();
    }, delay);

    return () => clearTimeout(timer);
  }, [smartCheckForUpdates]);

  // 업데이트 모달 표시 조건 개선
  const shouldShowUpdateModal = useCallback(() => {
    if (!githubUpdater.state.hasUpdate || !githubUpdater.state.releaseInfo) {
      return false;
    }

    // v prefix 제거하여 스킵된 버전과 일치하도록 함
    const version = githubUpdater.state.releaseInfo.tag_name.replace(/^v/, '');
    return shouldShowUpdateForVersion(version);
  }, [githubUpdater.state.hasUpdate, githubUpdater.state.releaseInfo]);

  const handleIntroClose = useCallback(() => {
    setShowIntroModal(false);

    // 안내를 본 후 자동 체크가 활성화되어 있다면 잠시 후 체크
    const settings = getUpdateSettings();
    if (settings.autoCheck) {
      setTimeout(() => {
        smartCheckForUpdates();
      }, POST_INTRO_CHECK_DELAY_MS);
    }
  }, [smartCheckForUpdates]);

  return {
    ...githubUpdater,
    smartCheckForUpdates,
    shouldShowUpdateModal: shouldShowUpdateModal(),
    showIntroModal,
    onIntroClose: handleIntroClose,
  };
}