import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * Computes a live status message for screen readers based on loading states.
 */
export function useLiveStatusMessage(deps: {
  isChecking: boolean;
  isLoading: boolean;
  isAnyLoading: boolean;
  isLoadingMessages: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
}): string {
  const { t } = useTranslation();

  return useMemo(() => {
    if (deps.isChecking) {
      return t("common.settings.checking");
    }
    if (deps.isLoading) {
      return t("status.initializing");
    }
    if (deps.isAnyLoading) {
      return t("status.loadingStats");
    }
    if (deps.isLoadingMessages) {
      return t("status.loadingMessages");
    }
    if (deps.isLoadingProjects) {
      return t("status.scanning");
    }
    if (deps.isLoadingSessions) {
      return t("status.loadingSessions");
    }
    return "";
  }, [
    deps.isChecking,
    deps.isLoading,
    deps.isAnyLoading,
    deps.isLoadingMessages,
    deps.isLoadingProjects,
    deps.isLoadingSessions,
    t,
  ]);
}
