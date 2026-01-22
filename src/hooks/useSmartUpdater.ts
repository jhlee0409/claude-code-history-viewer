import { useState, useEffect, useCallback } from 'react';
import { useGitHubUpdater } from './useGitHubUpdater';
import { 
  getUpdateSettings, 
  shouldCheckForUpdates, 
  shouldShowUpdateForVersion,
  isOnline 
} from '@/utils/updateSettings';

export function useSmartUpdater() {
  const githubUpdater = useGitHubUpdater();
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [introModalShown, setIntroModalShown] = useState(false);

  // 초기 안내 모달 표시 확인
  useEffect(() => {
    const settings = getUpdateSettings();
    if (!settings.hasSeenIntroduction && !introModalShown) {
      // 앱 시작 후 2초 후에 안내 모달 표시 (UX 개선)
      const timer = setTimeout(() => {
        setShowIntroModal(true);
        setIntroModalShown(true);
      }, 2000);
      
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
    const settings = getUpdateSettings();
    
    // 자동 체크가 비활성화되어 있으면 체크하지 않음
    if (!settings.autoCheck) {
      return;
    }

    let delay = 5000; // 기본 5초

    // 체크 주기에 따른 지연 시간 조정
    switch (settings.checkInterval) {
      case 'startup':
        delay = 5000; // 5초
        break;
      case 'daily':
        // 마지막 체크가 24시간 전인지 확인
        // (구현 복잡성으로 인해 startup과 동일하게 처리)
        delay = 5000;
        break;
      case 'weekly':
        // 주간 체크는 첫 실행 시만
        delay = 5000;
        break;
      case 'never':
        return; // 체크하지 않음
    }

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
      }, 1000);
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