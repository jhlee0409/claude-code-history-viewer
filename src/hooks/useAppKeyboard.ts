import { useEffect } from "react";
import { currentKeyEnvironment } from "@/commands/keys";
import { startMenuBridge } from "@/commands/nativeMenu";
import { tauriMenuDeps } from "@/commands/nativeMenuHost";
import { COMMANDS } from "@/commands/registry";
import { createShortcutHandler } from "@/commands/shortcuts";
import { useCommandContext } from "@/commands/useCommandContext";

/**
 * The app's keyboard shortcuts and, in the desktop app, its native menu: the
 * manifest commands (`src/commands/manifest.json`) reached by one window key
 * listener (`src/commands/shortcuts.ts`) and by the menu bar the Rust side
 * builds from the same manifest (`src/commands/nativeMenu.ts`).
 *
 * Each shortcut has one owner: where the native menu owns shortcuts (the Mac
 * app) the menu item runs a menu command's key and the listener skips it;
 * everywhere else the listener runs it.
 *
 * Mount once, at the app root. The listener and the menu bridge are bound
 * once and read the live state through the command context when a key or a
 * menu event arrives.
 */
export function useAppKeyboard() {
  const getContext = useCommandContext();

  useEffect(() => {
    const env = currentKeyEnvironment();
    const menu = env.runtime === "desktop" ? startMenuBridge(tauriMenuDeps(env, getContext)) : null;
    const handleKeyDown = createShortcutHandler({
      commands: COMMANDS,
      env,
      getContext,
      ownedByNativeMenu: menu?.owns,
    });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      menu?.stop();
    };
  }, [getContext]);
}
