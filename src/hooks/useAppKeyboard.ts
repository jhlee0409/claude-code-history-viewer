import { useEffect } from "react";
import { useModal } from "@/contexts/modal";
import { usePlatform } from "@/contexts/platform";
import { useAppStore } from "@/store/useAppStore";

/**
 * Global keyboard shortcuts for the app.
 * - Cmd+K: open global search
 * - Cmd+Shift+M: toggle message navigator (desktop only)
 */
export function useAppKeyboard() {
  const { openModal } = useModal();
  const { isMobile } = usePlatform();
  const toggleNavigator = useAppStore((s) => s.toggleNavigator);

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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModal, toggleNavigator, isMobile]);
}
