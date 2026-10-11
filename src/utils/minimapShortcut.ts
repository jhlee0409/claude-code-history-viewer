import { isMacOS } from "./platform";

/**
 * Keys shown wherever the minimap-toggle shortcut (Cmd/Ctrl+Shift+F) is
 * described. Mirrors `getPromptJumpKeysLabel` in
 * `components/MessageViewer/helpers/promptJump.ts`, kept as its own helper
 * here because the only consumer (`ViewMenuGroup`) lives under `layouts/`
 * and importing from that helper would drag in `messageKinds`.
 */
export function getMinimapToggleKeysLabel(): string {
  return isMacOS() ? "⌘⇧F" : "Ctrl+Shift+F";
}
