/**
 * The real host for the native-menu bridge (`nativeMenu.ts`): Tauri's event
 * channel, the `sync_menu_state` / `menu_journal` / `ack_menu_events`
 * commands, the app store and i18next.
 */
import i18n from "i18next";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { MENU_CHECKS, MENU_COMMAND_EVENT, type MenuBridgeDeps, type MenuState } from "./nativeMenu";
import { sessionCursorStore, type LiveMenuEvent, type MenuJournalSnapshot } from "./menuJournal";
import type { CommandContext } from "./registry";

export function tauriMenuDeps(getContext: () => CommandContext): MenuBridgeDeps {
  return {
    getContext,
    getLanguage: () => i18n.resolvedLanguage ?? i18n.language ?? "en",
    getFrontTabId: () => useAppStore.getState().activeDocumentId || null,
    getChecks: () => {
      const state = useAppStore.getState();
      return Object.fromEntries(Object.entries(MENU_CHECKS).map(([id, isOn]) => [id, isOn(state)]));
    },
    sync: async (state: MenuState) => {
      await api<null>("sync_menu_state", { state });
    },
    // Only the menu's ticks and greyed items may be stale until the next
    // change syncs; keys and menu events do not depend on them.
    onSyncError: () => toast.error(i18n.t("common.menu.syncFailed")),
    // The host keeps the events; the next menu event pulls again.
    onPullError: () => toast.error(i18n.t("common.menu.eventsFailed")),
    // The listener keeps retrying; once it attaches, the menu commands chosen meanwhile run in order.
    onListenError: () => toast.error(i18n.t("common.menu.listenFailed")),
    listen: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<LiveMenuEvent>(MENU_COMMAND_EVENT, (event) => handler(event.payload));
    },
    pullEvents: () => api<MenuJournalSnapshot>("menu_journal"),
    ackEvents: async (epoch, seq) => {
      await api<null>("ack_menu_events", { epoch, seq });
    },
    cursor: sessionCursorStore(),
    subscribe: (onChange) => {
      const unsubscribeStore = useAppStore.subscribe(onChange);
      i18n.on("languageChanged", onChange);
      // Some command state lives outside the store (the find field's mount):
      // coming back to the window re-checks it.
      window.addEventListener("focus", onChange);
      return () => {
        unsubscribeStore();
        i18n.off("languageChanged", onChange);
        window.removeEventListener("focus", onChange);
      };
    },
  };
}
