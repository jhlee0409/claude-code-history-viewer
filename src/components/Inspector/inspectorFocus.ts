/**
 * Focus across opening and closing the inspector (plan T9a a11y).
 *
 * - Opening it from the toolbar button or ⌘⇧M moves focus to its selected
 *   tab, so the keyboard lands in the panel that just appeared.
 * - Closing it while focus is inside (its close button, Escape, ⌘⇧M) puts
 *   focus back on the toolbar's inspector button; without this the focused
 *   element is removed and focus falls to the document body.
 * - Closing it while focus is elsewhere (the transcript) leaves focus there.
 *
 * Restoring a panel that was open at startup moves no focus: only these
 * user actions do.
 */
import { useAppStore } from "@/store/useAppStore";

export const INSPECTOR_ID = "inspector";
export const INSPECTOR_TOGGLE_ID = "inspector-toggle";

const inspectorElement = () => document.getElementById(INSPECTOR_ID);

export function inspectorHasFocus(): boolean {
  const panel = inspectorElement();
  return panel != null && panel.contains(document.activeElement);
}

/** Focus the selected tab once the panel has rendered. */
export function focusInspectorTab(): void {
  requestAnimationFrame(() => {
    inspectorElement()
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
  });
}

/** Focus the toolbar button, or the main content when it is not there. */
function focusInspectorToggle(): void {
  const toggle = document.getElementById(INSPECTOR_TOGGLE_ID);
  if (toggle instanceof HTMLElement && toggle.checkVisibility?.() !== false) {
    toggle.focus();
    return;
  }
  document.getElementById("main-content")?.focus();
}

/** Close the inspector, returning focus to its button when it held focus. */
export function closeInspector(): void {
  const hadFocus = inspectorHasFocus();
  useAppStore.getState().setInspectorOpen(false);
  if (hadFocus) focusInspectorToggle();
}

/** The toolbar button's and ⌘⇧M's action. */
export function toggleInspector(): void {
  if (useAppStore.getState().isInspectorOpen) {
    closeInspector();
    return;
  }
  useAppStore.getState().setInspectorOpen(true);
  focusInspectorTab();
}
