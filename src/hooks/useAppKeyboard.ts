import { useEffect } from "react";
import { useModal } from "@/contexts/modal";
import { usePlatform } from "@/contexts/platform";
import { useAppStore } from "@/store/useAppStore";

/**
 * True when the event target is a text input, textarea, select, or
 * contenteditable element, where a letter shortcut should be left to the
 * field instead of hijacked by a global handler.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

/**
 * Global keyboard shortcuts for the app.
 * - Cmd+K: open global search
 * - Cmd+Shift+M: toggle message navigator (desktop only)
 * - Cmd+Shift+F: toggle the session minimap (anywhere, including mobile; the
 *   strip's own mount gate decides whether that has any visible effect)
 */
export function useAppKeyboard() {
  const { openModal } = useModal();
  const { isMobile } = usePlatform();
  const toggleNavigator = useAppStore((s) => s.toggleNavigator);
  const toggleMinimap = useAppStore((s) => s.toggleMinimap);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openModal("globalSearch");
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        if (!isMobile) toggleNavigator();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        toggleMinimap();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModal, toggleNavigator, toggleMinimap, isMobile]);
}
