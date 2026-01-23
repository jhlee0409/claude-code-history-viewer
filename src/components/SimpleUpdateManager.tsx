import { useState, useEffect, useRef } from "react";
import { useSmartUpdater } from "../hooks/useSmartUpdater";
import { SimpleUpdateModal } from "./SimpleUpdateModal";
import { UpdateIntroModal } from "./UpdateConsentModal";
import { UpToDateNotification } from "./UpToDateNotification";
import { UpdateCheckingNotification } from "./UpdateCheckingNotification";
import { UpdateErrorNotification } from "./UpdateErrorNotification";

export function SimpleUpdateManager() {
  const updater = useSmartUpdater();
  const [showUpdateModal, setShowUpdateModal] = useState(true);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [showChecking, setShowChecking] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const manualCheckRef = useRef(false);

  // 수동 체크 시 체크 중 알림 표시
  useEffect(() => {
    if (updater.state.isChecking && manualCheckRef.current) {
      setShowChecking(true);
    } else {
      setShowChecking(false);
    }
  }, [updater.state.isChecking]);

  // 수동 체크 결과 처리
  useEffect(() => {
    if (!updater.state.isChecking && manualCheckRef.current) {
      if (updater.state.error) {
        // 에러 발생
        setErrorMessage(updater.state.error);
        setShowError(true);
      } else if (!updater.state.hasUpdate) {
        // 최신 버전
        setShowUpToDate(true);
        setTimeout(() => setShowUpToDate(false), 3000);
      }
      // 업데이트가 있는 경우 업데이트 모달이 표시됨
      manualCheckRef.current = false;
    }
  }, [
    updater.state.isChecking,
    updater.state.hasUpdate,
    updater.state.error,
  ]);

  // 수동 업데이트 체크 이벤트 리스너
  useEffect(() => {
    const handleManualCheck = () => {
      manualCheckRef.current = true;
      setShowError(false);
      setShowUpToDate(false);
      updater.smartCheckForUpdates(true); // 강제 체크
    };

    window.addEventListener("manual-update-check", handleManualCheck);
    return () => {
      window.removeEventListener("manual-update-check", handleManualCheck);
    };
  }, [updater]);

  const handleCloseUpdateModal = () => {
    setShowUpdateModal(false);
  };

  return (
    <>
      {/* 업데이트 시스템 안내 모달 (첫 실행 시) */}
      <UpdateIntroModal
        isOpen={updater.showIntroModal}
        onClose={updater.onIntroClose}
      />

      {/* 개선된 업데이트 모달 */}
      <SimpleUpdateModal
        updater={updater}
        isVisible={showUpdateModal && updater.shouldShowUpdateModal}
        onClose={handleCloseUpdateModal}
      />

      {/* 체크 중 알림 (수동 체크 시) */}
      <UpdateCheckingNotification
        onClose={() => setShowChecking(false)}
        isVisible={showChecking}
      />

      {/* 최신 버전 알림 (수동 체크 시) */}
      <UpToDateNotification
        currentVersion={updater.state.currentVersion}
        onClose={() => setShowUpToDate(false)}
        isVisible={showUpToDate}
      />

      {/* 에러 알림 (수동 체크 시) */}
      <UpdateErrorNotification
        error={errorMessage}
        onClose={() => setShowError(false)}
        isVisible={showError}
      />
    </>
  );
}