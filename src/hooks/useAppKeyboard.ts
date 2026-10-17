import { useEffect } from "react";
import { currentKeyEnvironment } from "@/commands/keys";
import { startMenuBridge } from "@/commands/nativeMenu";
import { tauriMenuDeps } from "@/commands/nativeMenuHost";
import { COMMANDS, runCommand } from "@/commands/registry";
import { createShortcutHandler } from "@/commands/shortcuts";
import { useCommandContext } from "@/commands/useCommandContext";
import { createCtrlWheelZoom, engineOwnsZoomInput } from "@/commands/zoom";

/**
 * The app's keyboard shortcuts and, in the desktop app, its native menu: the
 * manifest commands (`src/commands/manifest.json`) reached by one window key
 * listener (`src/commands/shortcuts.ts`) and by the menu bar the Rust side
 * builds from the same manifest (`src/commands/nativeMenu.ts`).
 *
 * Each input has one fixed owner, never switched by asynchronous state:
 * - every app key: the key listener (in the Mac app it claims each one, so
 *   the menu item carrying the same key does not run it too);
 * - a menu click (or an accelerator that reached the menu while no page
 *   listened): the menu journal, oldest first, once each;
 * - zoom keys and Ctrl + wheel: the zoom commands (`src/commands/zoom.ts`),
 *   except on Windows, where WebView2 owns them along with pinch zoom.
 *
 * Mount once, at the app root. The listener and the menu bridge are bound
 * once and read the live state through the command context when a key or a
 * menu event arrives.
 */
export function useAppKeyboard() {
  const getContext = useCommandContext();

  useEffect(() => {
    const env = currentKeyEnvironment();
    const menu = env.runtime === "desktop" ? startMenuBridge(tauriMenuDeps(getContext)) : null;
    const handleKeyDown = createShortcutHandler({ commands: COMMANDS, env, getContext });
    window.addEventListener("keydown", handleKeyDown);
    const handleWheel =
      env.runtime === "desktop" && !engineOwnsZoomInput(env)
        ? createCtrlWheelZoom((step) => runCommand(step === "in" ? "view.zoomIn" : "view.zoomOut", getContext()))
        : null;
    if (handleWheel) window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (handleWheel) window.removeEventListener("wheel", handleWheel);
      menu?.stop();
    };
  }, [getContext]);
}
