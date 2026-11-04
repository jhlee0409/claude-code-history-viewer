import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage } from "@/types";

interface Options {
  sessionPath: string | null;
  messages: ClaudeMessage[];
  getScrollElement: () => HTMLElement | null;
  getScrollIndex: (uuid: string) => number | null;
  virtualizer: Virtualizer<HTMLElement, Element>;
  explicitTarget: string | null;
  restoringRef: MutableRefObject<boolean>;
}

/** Preserve a source row, not its obsolete flat index, across display filters. */
export function useFilterReadingPosition({ sessionPath, messages, getScrollElement, getScrollIndex, virtualizer, explicitTarget, restoringRef }: Options) {
  const pending = useRef<{ uuid: string; offset: number; messages: ClaudeMessage[]; sessionPath: string } | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const latest = useRef({ messages, explicitTarget, getScrollElement });
  useLayoutEffect(() => { latest.current = { messages, explicitTarget, getScrollElement }; });

  useEffect(() => {
    // The subscription runs before React replaces the old measured DOM.
    // showSystemMessages changes first; its HTTP reload arrives later.
    return useAppStore.subscribe((state, previous) => {
      if (state.selectedSession?.file_path !== sessionPath || state.targetMessageUuid !== previous.targetMessageUuid) {
        pending.current = null;
        cancelRef.current();
        return;
      }
      if (state.messageFilter === previous.messageFilter && state.showSystemMessages === previous.showSystemMessages) return;
      pending.current = null;
      cancelRef.current();
      const current = latest.current;
      if (current.explicitTarget || !sessionPath) return;
      const viewport = current.getScrollElement();
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const visible = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-uuid]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
        });
      // Match the viewer's existing tail-vs-up-reading distinction: keep
      // the read tail source at the tail, otherwise the first visible row.
      const atTail = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
      const node = atTail ? visible.at(-1) : visible[0];
      if (node?.dataset.messageUuid) pending.current = { uuid: node.dataset.messageUuid, offset: node.getBoundingClientRect().top - bounds.top, messages: current.messages, sessionPath };
    });
  }, [sessionPath]);

  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor || anchor.messages === messages) return;
    pending.current = null;
    if (anchor.sessionPath !== sessionPath || explicitTarget) return;
    const viewport = getScrollElement();
    const index = getScrollIndex(anchor.uuid);
    // A filtered-out source is unavailable: retain the existing viewport
    // fallback, without undoing the filter, fetching, or inventing a target.
    if (!viewport || index === null) return;
    let frame = 0;
    let remaining = 30;
    const stop = () => {
      cancelAnimationFrame(frame);
      restoringRef.current = false;
      viewport.removeEventListener("wheel", stop);
      viewport.removeEventListener("touchstart", stop);
      viewport.removeEventListener("keydown", onKey);
    };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stop();
    };
    const restore = () => {
      const node = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-uuid]"))
        .find((element) => element.dataset.messageUuid === anchor.uuid);
      if (node) {
        const delta = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
        if (Math.abs(delta) > 0.01) viewport.scrollTop += delta;
      } else {
        const [start] = virtualizer.getOffsetForIndex(index, "start") ?? [];
        if (typeof start === "number") viewport.scrollTop = start - anchor.offset;
      }
      if (--remaining > 0) frame = requestAnimationFrame(restore);
      else stop();
    };
    restoringRef.current = true;
    cancelRef.current = stop;
    viewport.addEventListener("wheel", stop, { passive: true });
    viewport.addEventListener("touchstart", stop, { passive: true });
    viewport.addEventListener("keydown", onKey);
    restore();
    return stop;
  }, [sessionPath, messages, explicitTarget, getScrollElement, getScrollIndex, virtualizer, restoringRef]);

  useEffect(() => () => { pending.current = null; cancelRef.current(); }, [sessionPath]);
}
