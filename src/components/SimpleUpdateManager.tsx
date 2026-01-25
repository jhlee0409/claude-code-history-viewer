import { useState, useEffect } from "react";
import { useUpdater } from "../hooks/useUpdater";
import { SimpleUpdateModal } from "./SimpleUpdateModal";
import { UpToDateNotification } from "./UpToDateNotification";
import { UpdateCheckingNotification } from "./UpdateCheckingNotification";
import { UpdateErrorNotification } from "./UpdateErrorNotification";

const AUTO_CHECK_DELAY_MS = 5_000; // 5 seconds after app start

export function SimpleUpdateManager() {
  const updater = useUpdater();
  const [showUpdateModal, setShowUpdateModal] = useState(true);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [showChecking, setShowChecking] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isManualCheck, setIsManualCheck] = useState(false);

  // Auto check on app start (production only)
  useEffect(() => {
    if (import.meta.env.DEV) return;

    const timer = setTimeout(() => {
      updater.checkForUpdates();
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show checking notification during manual check
  useEffect(() => {
    if (updater.state.isChecking && isManualCheck) {
      setShowChecking(true);
    } else {
      setShowChecking(false);
    }
  }, [updater.state.isChecking, isManualCheck]);

  // Handle manual check results
  useEffect(() => {
    if (!updater.state.isChecking && isManualCheck) {
      if (updater.state.error) {
        setErrorMessage(updater.state.error);
        setShowError(true);
      } else if (!updater.state.hasUpdate) {
        setShowUpToDate(true);
        setTimeout(() => setShowUpToDate(false), 3000);
      }
      setIsManualCheck(false);
    }
  }, [
    updater.state.isChecking,
    updater.state.hasUpdate,
    updater.state.error,
    isManualCheck,
  ]);

  // Listen for manual update check events
  useEffect(() => {
    const handleManualCheck = () => {
      setIsManualCheck(true);
      setShowError(false);
      setShowUpToDate(false);
      updater.checkForUpdates();
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
      {/* Update Modal */}
      <SimpleUpdateModal
        updater={updater}
        isVisible={showUpdateModal && updater.state.hasUpdate}
        onClose={handleCloseUpdateModal}
      />

      {/* Checking notification (manual check) */}
      <UpdateCheckingNotification
        onClose={() => {
          setShowChecking(false);
          setIsManualCheck(false);
        }}
        isVisible={showChecking}
      />

      {/* Up to date notification (manual check) */}
      <UpToDateNotification
        currentVersion={updater.state.currentVersion}
        onClose={() => setShowUpToDate(false)}
        isVisible={showUpToDate}
      />

      {/* Error notification (manual check) */}
      <UpdateErrorNotification
        error={errorMessage}
        onClose={() => setShowError(false)}
        onRetry={() => {
          setIsManualCheck(true);
          updater.checkForUpdates();
        }}
        isVisible={showError}
      />
    </>
  );
}
