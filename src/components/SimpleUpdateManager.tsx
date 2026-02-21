import { useState, useEffect, useRef, useCallback } from "react";
import type { UseUpdaterReturn } from "../hooks/useUpdater";
import { SimpleUpdateModal } from "./SimpleUpdateModal";
import { UpToDateNotification } from "./UpToDateNotification";
import { UpdateCheckingNotification } from "./UpdateCheckingNotification";
import { UpdateErrorNotification } from "./UpdateErrorNotification";
import { useAppStore } from "@/store/useAppStore";
import { shouldCheckForUpdates } from "@/utils/updateSettings";
import { resolveUpdateErrorMessage } from "@/utils/updateError";
import { useTranslation } from "react-i18next";

const AUTO_CHECK_DELAY_MS = 5_000; // 5 seconds after app start

interface SimpleUpdateManagerProps {
  updater: UseUpdaterReturn;
}

export function SimpleUpdateManager({ updater }: SimpleUpdateManagerProps) {
  const { t, i18n } = useTranslation();
  const updateSettings = useAppStore((state) => state.updateSettings);
  const loadUpdateSettings = useAppStore((state) => state.loadUpdateSettings);
  const setUpdateSetting = useAppStore((state) => state.setUpdateSetting);
  const postponeUpdate = useAppStore((state) => state.postponeUpdate);
  const skipVersion = useAppStore((state) => state.skipVersion);
  const checkForUpdates = updater.checkForUpdates;
  const dismissUpdate = updater.dismissUpdate;
  const { state } = updater;
  const isChecking = state.isChecking;
  const hasUpdate = state.hasUpdate;
  const updateError = state.error;
  const newVersion = state.newVersion;
  const currentVersion = state.currentVersion;
  const {
    autoCheck,
    checkInterval,
    respectOfflineStatus,
    lastPostponedAt,
    lastCheckedAt,
    postponeInterval,
  } = updateSettings;

  const [showUpToDate, setShowUpToDate] = useState(false);
  const [showChecking, setShowChecking] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isManualCheck, setIsManualCheck] = useState(false);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [lastCheckWasManual, setLastCheckWasManual] = useState(false);
  const hasAutoCheckedRef = useRef(false);

  const runCheckAndPersist = useCallback(async () => {
    try {
      await checkForUpdates();
      await setUpdateSetting("lastCheckedAt", Date.now());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : i18n.t("common.error.updateCheckFailed")
      );
      setShowError(true);
    }
  }, [checkForUpdates, setUpdateSetting, i18n]);

  const shouldRunAutoCheck = useCallback(() => {
    return shouldCheckForUpdates({
      settings: {
        autoCheck,
        checkInterval,
        respectOfflineStatus,
        lastPostponedAt,
        lastCheckedAt,
        postponeInterval,
      },
    });
  }, [
    autoCheck,
    checkInterval,
    respectOfflineStatus,
    lastPostponedAt,
    lastCheckedAt,
    postponeInterval,
  ]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        await loadUpdateSettings();
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            error instanceof Error ? error.message : i18n.t("common.error.updateCheckFailed")
          );
          setShowError(true);
        }
      } finally {
        if (mounted) setIsSettingsLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loadUpdateSettings, i18n]);

  // Auto check on app start (production only)
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!isSettingsLoaded) return;
    if (hasAutoCheckedRef.current) return;
    if (!shouldRunAutoCheck()) return;
    hasAutoCheckedRef.current = true;

    setLastCheckWasManual(false);

    const timer = setTimeout(() => {
      void runCheckAndPersist();
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [isSettingsLoaded, shouldRunAutoCheck, runCheckAndPersist]);

  // Show checking notification during manual check
  useEffect(() => {
    if (isChecking && isManualCheck) {
      setShowChecking(true);
    } else {
      setShowChecking(false);
    }
  }, [isChecking, isManualCheck]);

  // Handle manual check results
  useEffect(() => {
    if (!isChecking && isManualCheck) {
      if (updateError) {
        setErrorMessage(resolveUpdateErrorMessage(updateError, t));
        setShowError(true);
      } else if (!hasUpdate) {
        setShowUpToDate(true);
        setTimeout(() => setShowUpToDate(false), 3000);
      }
      setIsManualCheck(false);
    }
  }, [isChecking, hasUpdate, updateError, isManualCheck, t]);

  // Suppress auto-check update modal for postponed/skipped versions
  useEffect(() => {
    if (isChecking) return;
    if (!hasUpdate) return;
    if (lastCheckWasManual) return;

    const version = newVersion;
    if (!version) return;

    const now = Date.now();
    const isPostponed =
      !!updateSettings.lastPostponedAt &&
      now - updateSettings.lastPostponedAt < updateSettings.postponeInterval;
    const isSkipped =
      Array.isArray(updateSettings.skippedVersions) &&
      updateSettings.skippedVersions.includes(version);

    if (isPostponed || isSkipped) {
      dismissUpdate();
    }
  }, [
    dismissUpdate,
    isChecking,
    hasUpdate,
    newVersion,
    lastCheckWasManual,
    updateSettings.lastPostponedAt,
    updateSettings.postponeInterval,
    updateSettings.skippedVersions,
  ]);

  // Listen for manual update check events
  useEffect(() => {
    const handleManualCheck = () => {
      if (isChecking) return;

      setLastCheckWasManual(true);
      setIsManualCheck(true);
      setShowError(false);
      setShowUpToDate(false);

      void runCheckAndPersist();
    };

    window.addEventListener("manual-update-check", handleManualCheck);
    return () => {
      window.removeEventListener("manual-update-check", handleManualCheck);
    };
  }, [isChecking, runCheckAndPersist]);

  const handleCloseUpdateModal = () => {
    dismissUpdate();
  };

  const handleRemindLater = async () => {
    try {
      await postponeUpdate();
      dismissUpdate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("common.error.updateCheckFailed"));
      setShowError(true);
    }
  };

  const handleSkipVersion = async () => {
    try {
      if (newVersion) {
        await skipVersion(newVersion);
      }
      dismissUpdate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("common.error.updateCheckFailed"));
      setShowError(true);
    }
  };

  return (
    <>
      {/* Update Modal */}
      <SimpleUpdateModal
        updater={updater}
        isVisible={hasUpdate}
        onClose={handleCloseUpdateModal}
        onRemindLater={handleRemindLater}
        onSkipVersion={handleSkipVersion}
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
        currentVersion={currentVersion}
        onClose={() => setShowUpToDate(false)}
        isVisible={showUpToDate}
      />

      {/* Error notification (manual check) */}
      <UpdateErrorNotification
        error={errorMessage}
        onClose={() => setShowError(false)}
        onRetry={() => {
          if (isChecking) return;

          setLastCheckWasManual(true);
          setIsManualCheck(true);
          setShowError(false);
          setShowUpToDate(false);

          void runCheckAndPersist();
        }}
        isVisible={showError}
      />
    </>
  );
}
