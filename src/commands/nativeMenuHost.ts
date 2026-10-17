/**
 * The real host for the native-menu bridge (`nativeMenu.ts`): Tauri's event
 * channel, the `sync_menu_state` command, the app store and i18next.
 */
import i18n from "i18next";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { KeyEnvironment } from "./keys";
import { MENU_CHECKS, MENU_COMMAND_EVENT, type MenuBridgeDeps, type MenuState } from "./nativeMenu";
import type { CommandContext } from "./registry";

export function tauriMenuDeps(env: KeyEnvironment, getContext: () => CommandContext): MenuBridgeDeps {
  return {
    env,
    getContext,
    getLanguage: () => i18n.resolvedLanguage ?? i18n.language ?? "en",
    getChecks: () => {
      const state = useAppStore.getState();
      return Object.fromEntries(Object.entries(MENU_CHECKS).map(([id, isOn]) => [id, isOn(state)]));
    },
    sync: (state: MenuState) => api<string[]>("sync_menu_state", { state }),
    listen: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<string>(MENU_COMMAND_EVENT, (event) => handler(event.payload));
    },
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
