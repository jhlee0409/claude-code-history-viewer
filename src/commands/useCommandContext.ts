/**
 * The command context, built from the app's live state and actions.
 *
 * Returns a stable getter: a shortcut or a palette pick reads the store and
 * the latest actions at the moment it runs, so the window listener is bound
 * once and never re-bound per render.
 */
import { useCallback, useEffect, useRef } from "react";
import { useModal } from "@/contexts/modal";
import { usePlatform } from "@/contexts/platform";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";
import { ownPlace } from "@/navigation/ownership";
import { selectPlace } from "@/store/slices/navigationSlice";
import { useAppStore } from "@/store/useAppStore";
import { closeTab, cycleTab, newTab, selectTabAt } from "@/navigation/tabs";
import { focusFindTarget, hasFindTarget } from "./findTarget";
import type { CommandActions, CommandContext } from "./registry";

/** The event the desktop updater listens for (`SimpleUpdateManager`). */
export const MANUAL_UPDATE_CHECK_EVENT = "manual-update-check";

export function useCommandContext(): () => CommandContext {
  const { openModal } = useModal();
  const { isDesktop, isMobile } = usePlatform();
  const { goBack, goForward, switchToSettings, switchToArchive, openView } = useAnalyticsNavigation();
  const screens = { openView };
  const toggleNavigator = useAppStore((s) => s.toggleNavigator);
  const toggleMinimap = useAppStore((s) => s.toggleMinimap);

  const actions: CommandActions = {
    openPalette: () => openModal("globalSearch"),
    goBack,
    goForward,
    focusFind: () => {
      focusFindTarget();
    },
    toggleNavigator,
    toggleMinimap,
    openSettingsManager: switchToSettings,
    openArchive: switchToArchive,
    openFeedback: () => openModal("feedback"),
    checkForUpdates: () => window.dispatchEvent(new Event(MANUAL_UPDATE_CHECK_EVENT)),
    newTab: () => newTab(),
    closeTab: () => closeTab(useAppStore.getState().activeDocumentId, screens),
    cycleTab: (step) => cycleTab(step, screens),
    selectTabAt: (position) => selectTabAt(position, screens),
  };
  const latest = useRef({ actions, isDesktop, isMobile });
  useEffect(() => {
    latest.current = { actions, isDesktop, isMobile };
  });

  return useCallback((): CommandContext => {
    const state = useAppStore.getState();
    const { actions: current, isDesktop: desktop, isMobile: mobile } = latest.current;
    return {
      place: selectPlace(state),
      runtime: desktop ? "desktop" : "web",
      isMobile: mobile,
      canGoBack: state.placeHistory.back.length > 0,
      canGoForward: state.placeHistory.forward.length > 0,
      hasFindTarget: hasFindTarget(),
      tabCount: state.documents.length,
      ownPlace: () => ownPlace(useAppStore.getState),
      actions: current,
    };
  }, []);
}
