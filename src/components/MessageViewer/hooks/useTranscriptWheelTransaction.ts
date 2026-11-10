import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import i18n from "@/i18n";
import { elementScroll, observeElementOffset, type Virtualizer } from "@tanstack/react-virtual";

type TranscriptVirtualizer = Virtualizer<HTMLElement, Element>;
type OffsetObserver = {
  instance: TranscriptVirtualizer;
  element: HTMLElement | null;
  generation: number;
  deliver: (offset: number, scrolling: boolean) => void;
};


/** Own logical offset delivery while deferring the physical offset. Core remains
 * the only anchor policy: its resizeItem corrections change the logical target,
 * and its normal range/measurement pipeline commits before the single release.
 * Nothing here acknowledges compositor/raster readiness. */
export function useTranscriptWheelTransaction(owner?: unknown) {
  // Reuse the app notification host outside the transcript's render tree.
  // A failure episode belongs to this viewer, never to a document-global key.
  const notification = useRef<string | number | null>(null);
  const mounted = useRef(false);
  const clearFailure = useCallback(() => {
    const id = notification.current;
    notification.current = null;
    if (id !== null) toast.dismiss(id);
  }, []);
  const reportFailure = useCallback(() => {
    if (!mounted.current || notification.current !== null) return;
    const release = () => { if (notification.current === id) notification.current = null; };
    const id = toast.error(i18n.t("error.unexpectedError"), { onDismiss: release, onAutoClose: release });
    notification.current = id;
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearFailure(); };
  }, [clearFailure]);
  const selection = useRef(owner);
  selection.current = owner;
  const active = useRef(false);
  const lastRelease = useRef<{ element: HTMLElement; physical: number; logical: number } | null>(null);
  const deliverOffset = useRef<OffsetObserver | null>(null);
  const generation = useRef(0);
  const observeOffset = useCallback<typeof observeElementOffset<HTMLElement>>((instance, callback) => {
    const observer = { instance, element: instance.scrollElement, generation: ++generation.current, deliver: callback };
    deliverOffset.current = observer;
    const cleanup = observeElementOffset(instance, callback);
    return () => {
      if (deliverOffset.current === observer) deliverOffset.current = null;
      cleanup?.();
    };
  }, []);
  const scrollToFn = useCallback<typeof elementScroll<HTMLElement>>((offset, options, instance) => {
    // Core eagerly folds adjustments into scrollOffset even when this physical
    // write is withheld. Do not add a second anchor or replay each correction.
    if (!active.current) elementScroll(offset, options, instance);
  }, []);

  return { observeOffset, scrollToFn, active, deliverOffset, lastRelease, selection, reportFailure, clearFailure };
}

export function useTranscriptWheelBoundary(instance: TranscriptVirtualizer,
  { active, deliverOffset, lastRelease, selection, reportFailure, clearFailure }: ReturnType<typeof useTranscriptWheelTransaction>) {
    // Like core's _willUpdate, resolve after every commit: OverlayScrollbars can
    // replace its viewport without changing getScrollElement's function identity.
    useLayoutEffect(() => {
      const scroller = instance.scrollElement;
      if (!scroller) return;
      const wheel = (event: WheelEvent) => {
        const observer = deliverOffset.current;
        if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.shiftKey ||
            event.deltaX !== 0 || !Number.isFinite(event.deltaY) || event.deltaY === 0 || !observer) return;
        const style = getComputedStyle(scroller);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
        const delta = event.deltaY * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? scroller.clientHeight : 1);
        for (const node of event.composedPath()) {
          if (node === scroller) break;
          if (!(node instanceof HTMLElement)) continue;
          const overflow = getComputedStyle(node).overflowY;
          if (!/^(auto|scroll|overlay)$/.test(overflow) || node.scrollHeight <= node.clientHeight) continue;
          const canConsume = delta < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight;
          if (canConsume || /^(contain|none)$/.test(getComputedStyle(node).overscrollBehaviorY)) return;
        }
        const before = scroller.scrollTop;
        if (active.current) { event.preventDefault(); return; }
        if ((delta > 0 && before >= scroller.scrollHeight - scroller.clientHeight) ||
            (delta < 0 && before <= 0)) return;
        const previous = lastRelease.current;
        const base = previous?.element === scroller && previous.physical === before ? previous.logical : before;
        const target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, base + delta));
        if (target === base) return; // Preserve ancestor edge chaining.
        const priorLogical = instance.scrollOffset ?? before;
        const owner = selection.current;
        const count = instance.options.count;
        const margin = instance.options.scrollMargin;
        const owns = () => deliverOffset.current === observer && observer.instance === instance &&
          observer.element === scroller && instance.scrollElement === scroller && scroller.isConnected &&
          instance.options.getScrollElement() === scroller && selection.current === owner &&
          instance.options.count === count && instance.options.scrollMargin === margin;
        if (!owns()) return;
        event.preventDefault();
        active.current = true;
        const normalOnChange = instance.options.onChange;
        const quietOnChange = (v: TranscriptVirtualizer) => normalOnChange(v, false);
        // The first observer delivery enters from a DOM event, not a layout
        // effect. Subsequent renders read active to disable adapter flushSync.
        instance.setOptions({ ...instance.options, onChange: quietOnChange });
        const rollback = () => {
          if (!owns()) return false;
          const onChange = instance.options.onChange;
          const quiet = (v: TranscriptVirtualizer) => onChange(v, false);
          instance.setOptions({ ...instance.options, onChange: quiet });
          try {
            flushSync(() => {
              // Clear any intended-write echo before restoring the exact
              // logical fraction, not the quantized physical scrollTop.
              observer.deliver(before, false);
              observer.deliver(priorLogical, false);
            });
          } finally {
            if (instance.options.onChange === quiet) instance.setOptions({ ...instance.options, onChange });
          }
          return owns();
        };
        // React 19 can report an uncaught render error via window.error rather
        // than throw from flushSync. Observe, but do not suppress that report.
        let renderFailure: unknown;
        const recordFailure = (error: ErrorEvent) => { renderFailure = error.error; };
        const window = scroller.ownerDocument.defaultView;
        window?.addEventListener("error", recordFailure);
        try {
          flushSync(() => {
            // Consume core's outstanding physical-write read-back first. A new
            // subpixel user delta must not be mistaken for its 1.5px echo.
            observer.deliver(before, true);
            observer.deliver(target, true);
          });
          if (!owns()) {
            // Selection, streaming data and viewport replacement are normal
            // cancellation, not scroll failures. React owns render-error UI.
            if (renderFailure) console.error("Wheel transaction render failed", renderFailure);
            return;
          }
          const destination = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, instance.scrollOffset ?? target));
          // A shrinking committed sizer can clamp native scrollTop even while
          // our writer is withheld. DOM boxes belong to that current physical
          // origin, not the offset captured before the synchronous commit.
          const physicalOrigin = scroller.scrollTop;
          const viewportTop = scroller.getBoundingClientRect().top + scroller.clientTop;
          let coveredUntil = Math.max(destination, instance.options.scrollMargin);
          const total = instance.getTotalSize();
          let neededUntil = Math.min(destination + scroller.clientHeight, margin + total);
          const boxes = [...instance.elementsCache.values()].filter(node => node.isConnected && scroller.contains(node)).map(node => {
            const rect = node.getBoundingClientRect();
            return { node, height: rect.height, top: rect.top - viewportTop + physicalOrigin, bottom: rect.bottom - viewportTop + physicalOrigin };
          }).sort((a, b) => a.top - b.top);
          // scrollMargin/clientHeight/scrollHeight may be integer layout reads,
          // while the containing block and measured row boxes are fractional.
          // Only a mounted, measured final data row can certify the real end;
          // never infer it from the last overscan box or an estimated tail.
          const last = instance.getVirtualItems().at(-1);
          const terminal = last && boxes.find(box => instance.elementsCache.get(last.key) === box.node);
          const parent = terminal?.node.parentElement;
          if (last && last.index === count - 1 && terminal && parent &&
              instance.indexFromElement(terminal.node) === last.index && instance.options.getItemKey(last.index) === last.key &&
              (instance.itemSizeCache.get(last.key) === last.size ||
                (last.size === 0 && terminal.height === 0 && terminal.node.getAttribute("aria-hidden") === "true")) &&
              Math.abs(terminal.height - last.size) <= 0.01 &&
              Math.abs(last.end - (margin + total)) <= 0.01 &&
              getComputedStyle(terminal.node).position === "absolute" && getComputedStyle(parent).position === "relative") {
            // Absolute top:0 rows originate at the parent's padding edge (inside
            // its fractional border), not the rounded virtual scrollMargin.
            const origin = parent.getBoundingClientRect().top + (parseFloat(getComputedStyle(parent).borderTopWidth) || 0) - viewportTop + physicalOrigin;
            const end = origin + total;
            if (Math.abs(terminal.top - (origin + last.start - margin)) <= 0.01 && Math.abs(terminal.bottom - end) <= 0.01) {
              neededUntil = Math.min(neededUntil, end);
            }
          }
          for (const box of boxes) {
            if (box.bottom <= coveredUntil) continue;
            if (box.top > coveredUntil + 0.01) break;
            coveredUntil = box.bottom;
          }
          if (coveredUntil < neededUntil || renderFailure) {
            rollback();
            if (!renderFailure) reportFailure();
            return;
          }
          elementScroll(destination, { behavior: "instant" }, instance);
          lastRelease.current = { element: scroller, physical: scroller.scrollTop, logical: destination };
          clearFailure();
        } catch (error) {
          let restored = false;
          try { restored = rollback(); }
          catch (rollbackError) { console.error("Wheel transaction rollback failed", rollbackError); }
          if (!renderFailure) reportFailure();
          if (restored) throw error; // Original exception, only after recovery.
          console.error("Wheel transaction failed after owner disposal", error);
        } finally {
          window?.removeEventListener("error", recordFailure);
          active.current = false;
          // Adapter renders may have installed a new callback (or selection).
          if (instance.options.onChange === quietOnChange) instance.setOptions({ ...instance.options, onChange: normalOnChange });
        }
      };
      scroller.addEventListener("wheel", wheel, { passive: false });
      return () => scroller.removeEventListener("wheel", wheel);
    });
}
