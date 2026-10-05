/**
 * useVisibleMessageTracking Hook
 *
 * Reports the uuid of the first message row currently visible in the main
 * transcript, so the Messages panel's outline mode can highlight the turn
 * containing it (Design, "Highlighting the turn in view"). Gated on outline
 * mode only - never `isNavigatorOpen`, which describes the desktop panel
 * and never the narrow-screen sheet (Verified constraints) - so the
 * highlight still tracks while the sheet is open on a narrow screen.
 */

import { useEffect, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { FlattenedMessage } from "../types";
import { findFirstVisibleMessageUuid } from "../helpers/visibleMessage";

/** At most one store write per this many ms, with a trailing call so the final scroll position is always recorded. */
const THROTTLE_MS = 200;

interface UseVisibleMessageTrackingOptions {
  /** `navigatorViewMode === "outline"` only; list mode costs nothing extra. */
  enabled: boolean;
  virtualizer: Virtualizer<HTMLElement, Element>;
  flattenedMessages: readonly FlattenedMessage[];
  getScrollElement: () => HTMLElement | null;
  /** `getScrollElement()` returns null before OverlayScrollbars finishes mounting; re-attaches once this flips true. */
  scrollElementReady: boolean;
  setVisibleMessageUuid: (uuid: string | null) => void;
}

export function useVisibleMessageTracking({
  enabled,
  virtualizer,
  flattenedMessages,
  getScrollElement,
  scrollElementReady,
  setVisibleMessageUuid,
}: UseVisibleMessageTrackingOptions): void {
  // Refs, not closure locals: this effect's own cleanup (see below) runs on
  // every dependency change, and closure-local throttle state would reset
  // right along with it, so the trailing call would never fire.
  const lastRunRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVisibleMessageUuid(null);
      return;
    }
    if (!scrollElementReady) return;
    const viewport = getScrollElement();
    if (!viewport) return;

    const report = () => {
      const uuid = findFirstVisibleMessageUuid(
        virtualizer.getVirtualItems(),
        flattenedMessages,
        viewport.scrollTop,
      );
      setVisibleMessageUuid(uuid);
    };

    const scheduleReport = () => {
      const now = Date.now();
      const elapsed = now - lastRunRef.current;
      if (elapsed >= THROTTLE_MS) {
        if (pendingTimerRef.current != null) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        lastRunRef.current = now;
        report();
        return;
      }
      if (pendingTimerRef.current != null) return;
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        lastRunRef.current = Date.now();
        report();
      }, THROTTLE_MS - elapsed);
    };

    // Record the initial position immediately rather than waiting for the
    // first scroll or content change.
    scheduleReport();
    viewport.addEventListener("scroll", scheduleReport, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", scheduleReport);
      if (pendingTimerRef.current != null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
    // `virtualizer` is the same mutated instance across renders (as
    // `usePromptJump` also assumes); `flattenedMessages` changing is what
    // should re-run this (new content), not every scroll-driven re-render.
  }, [enabled, scrollElementReady, virtualizer, flattenedMessages, getScrollElement, setVisibleMessageUuid]);
}
