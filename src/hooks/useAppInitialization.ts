import { useEffect, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useLanguageStore } from "@/store/useLanguageStore";
import { type SupportedLanguage } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useFileWatcher } from "./useFileWatcher";

/**
 * App initialization side effects:
 * - Language loading + app init
 * - Font scale CSS variable
 * - High contrast mode
 * - i18n language sync
 * - Message restoration on view switch
 */
export function useAppInitialization(deps: {
  isMessagesView: boolean;
}) {
  const { i18n: i18nInstance } = useTranslation();
  const { language, loadLanguage } = useLanguageStore();

  const initializeApp = useAppStore((s) => s.initializeApp);
  const selectSession = useAppStore((s) => s.selectSession);
  const fontScale = useAppStore((s) => s.fontScale);
  const highContrast = useAppStore((s) => s.highContrast);
  const watcherEnabled = useAppStore((s) => s.watcherEnabled);
  const triggerSessionRefresh = useAppStore((s) => s.triggerSessionRefresh);

  const handleSessionChanged = useCallback(
    (event: { projectPath: string; sessionPath: string }) => {
      triggerSessionRefresh(event.projectPath, event.sessionPath);
    },
    [triggerSessionRefresh]
  );

  // File watcher: auto-refresh when session files change on disk
  useFileWatcher({
    onSessionChanged: handleSessionChanged,
    enabled: watcherEnabled,
    debounceMs: 500,
  });

  // Language loading + app initialization
  useEffect(() => {
    const initialize = async () => {
      try {
        await loadLanguage();
      } catch (error) {
        console.error("Failed to load language:", error);
      }
      try {
        await initializeApp();
      } catch (error) {
        console.error("Failed to initialize app:", error);
      }
    };
    initialize();
  }, [initializeApp, loadLanguage]);

  // Font scale CSS variable
  useEffect(() => {
    const scale = Number.isFinite(fontScale) ? fontScale / 100 : 1;
    document.documentElement.style.setProperty(
      "--app-font-scale",
      String(scale)
    );
  }, [fontScale]);

  // High contrast mode
  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast);
  }, [highContrast]);

  // i18n language sync
  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      const currentLang = lng.startsWith("zh")
        ? lng.includes("TW") || lng.includes("HK")
          ? "zh-TW"
          : "zh-CN"
        : lng.split("-")[0];

      if (
        currentLang &&
        currentLang !== language &&
        ["en", "ko", "ja", "zh-CN", "zh-TW"].includes(currentLang)
      ) {
        useLanguageStore.setState({
          language: currentLang as SupportedLanguage,
        });
      }
    };

    i18nInstance.on("languageChanged", handleLanguageChange);
    return () => {
      i18nInstance.off("languageChanged", handleLanguageChange);
    };
  }, [language, i18nInstance]);

  // Restore messages when switching back to messages view with empty messages
  useEffect(() => {
    if (!deps.isMessagesView) return;
    const { selectedSession: session, messages: msgs } =
      useAppStore.getState();
    if (session != null && msgs.length === 0) {
      void (async () => {
        try {
          await selectSession(session);
        } catch (error) {
          console.error("Failed to restore session messages:", error);
        }
      })();
    }
  }, [deps.isMessagesView, selectSession]);
}
