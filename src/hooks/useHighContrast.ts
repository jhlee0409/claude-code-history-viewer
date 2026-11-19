import { useSyncExternalStore } from "react";
import { useAppStore } from "@/store/useAppStore";

/**
 * High contrast (inner-UI plan F1b, D11): the user's own choice in the gear
 * menu wins; until they make one, the OS "increase contrast" setting
 * (`prefers-contrast: more`) decides; otherwise standard contrast.
 */

export const CONTRAST_MORE_QUERY = "(prefers-contrast: more)";

/** `choice` is the stored menu choice (null = never chosen). */
export function resolveHighContrast(choice: boolean | null, systemPrefersMore: boolean): boolean {
  return choice ?? systemPrefersMore;
}

function contrastQuery(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(CONTRAST_MORE_QUERY) : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const query = contrastQuery();
  if (!query || typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemPrefersMore = () => contrastQuery()?.matches === true;

/** The OS asks for more contrast (live: follows a change while the app runs). */
export function useSystemPrefersMoreContrast(): boolean {
  return useSyncExternalStore(subscribe, systemPrefersMore, () => false);
}

/** Whether the high-contrast theme is on right now. */
export function useEffectiveHighContrast(): boolean {
  const choice = useAppStore((s) => s.highContrast);
  const system = useSystemPrefersMoreContrast();
  return resolveHighContrast(choice, system);
}
