import { useEffect } from "react";
import { currentKeyEnvironment } from "@/commands/keys";
import { COMMANDS } from "@/commands/registry";
import { createShortcutHandler, NATIVE_MENU_COMMANDS } from "@/commands/shortcuts";
import { useCommandContext } from "@/commands/useCommandContext";

/**
 * The app's keyboard shortcuts: the manifest commands' shortcuts
 * (`src/commands/manifest.json`), served by one window listener
 * (`src/commands/shortcuts.ts`). Among them the three this hook used to
 * hard-code: ⌘K (palette), ⌘⇧M (inspector, not on mobile) and ⌘⇧F
 * (minimap, not while typing).
 *
 * Mount once, at the app root. The listener is bound once and reads the
 * live state through the command context when a key arrives.
 */
export function useAppKeyboard() {
  const getContext = useCommandContext();

  useEffect(() => {
    const env = currentKeyEnvironment();
    const handleKeyDown = createShortcutHandler({
      commands: COMMANDS,
      env,
      getContext,
      nativeOwned: env.runtime === "desktop" ? NATIVE_MENU_COMMANDS : undefined,
    });
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [getContext]);
}
