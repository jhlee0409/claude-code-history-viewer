/**
 * Where the inspector can show: the one rule the shell (`AppLayout`), the
 * toolbar button (`Header`) and the `view.toggleInspector` command share.
 *
 * Toggling where the panel cannot show would flip the saved open state
 * unseen, and the panel would pop open later on a screen that has one; so
 * the command and the button are enabled exactly where the panel can be.
 *
 * Pure and free of screen imports, so the command registry can use it.
 */
import type { View } from "@/navigation/place";

/** The screens the inspector sits beside: the transcript only. */
const INSPECTOR_VIEWS: ReadonlySet<View> = new Set<View>(["conversation"]);

export interface InspectorPlace {
  /** The screen on show. */
  view: View;
  /** A session is open: every inspector tab is about one session. */
  hasSession: boolean;
}

/** The screen and selection give the inspector something to show. */
export function isInspectorPlace({ view, hasSession }: InspectorPlace): boolean {
  return hasSession && INSPECTOR_VIEWS.has(view);
}

/**
 * The inspector can show here: an inspector place on the desktop layout.
 * On a phone it never shows (a hidden panel would still run its loaders).
 */
export function isInspectorAvailable({ isMobile, ...place }: InspectorPlace & { isMobile: boolean }): boolean {
  return !isMobile && isInspectorPlace(place);
}
