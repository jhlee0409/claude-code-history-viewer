import { shortcutLabel } from "@/commands/keys";
import { getCommand } from "@/commands/registry";

/**
 * Keys shown wherever the minimap-toggle shortcut is described (`⌘⇧F` on
 * macOS, `Ctrl+Shift+F` elsewhere), read from the command manifest so the
 * hint cannot drift from the key that actually works.
 */
export function getMinimapToggleKeysLabel(): string {
  return shortcutLabel(getCommand("view.toggleMinimap")?.shortcut ?? null) ?? "";
}
