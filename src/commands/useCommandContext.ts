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
import { toggleInspector } from "@/components/Inspector/inspectorFocus";
import { MANUAL_UPDATE_CHECK_EVENT, OPEN_PREFERENCES_EVENT } from "./appEvents";
import { focusFindTarget, hasFindTarget } from "./findTarget";
import type { CommandActions, CommandContext } from "./registry";

export { MANUAL_UPDATE_CHECK_EVENT, OPEN_PREFERENCES_EVENT };

export function useCommandContext(): () => CommandContext {
  const { openModal } = useModal();
  const { isDesktop, isMobile } = usePlatform();
  const { goBack, goForward, switchToSettings, switchToArchive, openView } = useAnalyticsNavigation();
  const screens = { openView };
  const toggleMinimap = useAppStore((s) => s.toggleMinimap);

  const actions: CommandActions = {
    openPalette: () => openModal("globalSearch"),
    openPreferences: () => window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT)),
    goBack,
    goForward,
    focusFind: () => {
      focusFindTarget();
    },
    // Moves focus into the panel it opens, and back to the toolbar button
    // when it closes the panel that held focus (`inspectorFocus.ts`).
    toggleInspector,
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
