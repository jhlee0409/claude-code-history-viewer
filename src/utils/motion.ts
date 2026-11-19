/**
 * Motion preferences for code that moves things itself (inner-UI plan F1b,
 * G-MO1). CSS motion is switched off by the base layer under
 * `prefers-reduced-motion: reduce`; a JS scroll with `behavior: "smooth"` is
 * not, so every scroll call asks `scrollBehavior()` instead of hard-coding
 * "smooth" (src/test/motion.invariant.test.ts keeps it that way).
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** True when the OS / browser asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

/** `"smooth"`, or `"auto"` (an instant jump) when reduced motion is on. Read at call time. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
