import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * Exists so a component can gate what it *mounts* on the same breakpoint its
 * CSS gates what it *shows*. A Tailwind `hidden xl:block` wrapper still mounts
 * its children, so an effect inside runs and can fetch for a panel nobody can
 * see. Gating the mount on the same query keeps the two in agreement.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    // Re-read on subscribe: the query can have changed, or matched between the
    // initial render and this effect.
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/**
 * Tailwind's `xl` breakpoint. Kept next to the query it wraps so the number
 * cannot drift from the `xl:` class names that depend on it.
 */
export const XL_BREAKPOINT = 1280;

/** Whether the viewport is at or above Tailwind's `xl` breakpoint. */
export function useIsXlUp(): boolean {
  return useMediaQuery(`(min-width: ${XL_BREAKPOINT}px)`);
}
