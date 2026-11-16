import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import i18n from "@/i18n";
import { elementScroll, observeElementOffset, type Virtualizer, type VirtualItem } from "@tanstack/react-virtual";

type TranscriptVirtualizer = Virtualizer<HTMLElement, Element>;
type OffsetObserver = {
  instance: TranscriptVirtualizer;
  element: HTMLElement | null;
  generation: number;
  deliver: (offset: number, scrolling: boolean) => void;
};


type CommittedScrollFrame = {
  instance: TranscriptVirtualizer;
  element: HTMLElement | null;
  owner: unknown;
  count: number;
  margin: number;
  totalSize: number;
  rectWidth: number | undefined;
  rectHeight: number | undefined;
  rows: Pick<VirtualItem, "key" | "index" | "start" | "size" | "end">[];
};

// Equal values from the last committed render, never a before/after core snapshot.
// This does not certify paint. Unknown or changed geometry retains the sync path.
function sameCommittedFrame(instance: TranscriptVirtualizer, frame: CommittedScrollFrame, owner: unknown) {
  if (frame.instance !== instance || frame.owner !== owner || frame.element !== instance.scrollElement ||
      !frame.element?.isConnected || instance.options.getScrollElement() !== frame.element ||
      frame.count !== instance.options.count || frame.margin !== instance.options.scrollMargin ||
      frame.rectWidth !== instance.scrollRect?.width || frame.rectHeight !== instance.scrollRect?.height ||
      frame.totalSize !== instance.getTotalSize() || frame.rows.length === 0) return false;
  const rows = instance.getVirtualItems();
  return rows.length === frame.rows.length && rows.every((row, index) => {
    const previous = frame.rows[index]!;
    return row.key === previous.key && row.index === previous.index && row.start === previous.start &&
      row.size === previous.size && row.end === previous.end;
  });
}

/** Own logical offset delivery while deferring the physical offset. Core remains
 * the only anchor policy: its resizeItem corrections change the logical target,
 * and its normal range/measurement pipeline commits before the single release.
 * Nothing here acknowledges compositor/raster readiness. */
export function useTranscriptWheelTransaction(owner?: unknown, onRelease?: () => void) {
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
  // Only a committed render publishes the listener; an abandoned render's
  // closure must never run after a later wheel batch.
  const releaseListener = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => { releaseListener.current = onRelease; });
  useLayoutEffect(() => () => { releaseListener.current = undefined; }, []);
  const active = useRef(false);
  const committed = useRef<CommittedScrollFrame | null>(null);
  const cancelPending = useRef<() => void>(() => {});
  useLayoutEffect(() => () => { cancelPending.current(); committed.current = null; }, []);
  const lastRelease = useRef<{ element: HTMLElement; physical: number; logical: number } | null>(null);
  const deliverOffset = useRef<OffsetObserver | null>(null);
  const generation = useRef(0);
  const observeOffset = useCallback<typeof observeElementOffset<HTMLElement>>((instance, callback) => {
    const observer = { instance, element: instance.scrollElement, generation: ++generation.current, deliver: callback };
    cancelPending.current();
    deliverOffset.current = observer;
    let lastObservedOffset = observer.element?.scrollTop ?? instance.scrollOffset ?? 0;
    const cleanup = observeElementOffset(instance, (offset, scrolling) => {
      if (deliverOffset.current !== observer) return;
      const previous = lastRelease.current;
      const releaseEcho = previous?.element === observer.element && previous.physical === offset;
      if (!active.current && offset !== lastObservedOffset && !releaseEcho) {
        // Invalidate before core can synchronously commit and replace listeners.
        // An unchanged scroll-end notification or our own release echo is not
        // a new user input and must not discard the next queued wheel.
        cancelPending.current();
        lastRelease.current = null;
      }
      lastObservedOffset = offset;
      const normal = instance.options.onChange;
      const frame = committed.current;
      if (active.current || !scrolling || instance.isScrolling || !frame || !normal) {
        callback(offset, scrolling);
        return;
      }
      const gated: typeof normal = (value, sync) => normal(value, sync && !sameCommittedFrame(value, frame, selection.current));
      instance.setOptions({ ...instance.options, onChange: gated });
      try { callback(offset, scrolling); }
      finally {
        // A commit may have installed a newer adapter/owner callback.
        if (instance.options.onChange === gated) instance.setOptions({ ...instance.options, onChange: normal });
      }
    });
    return () => {
      if (deliverOffset.current === observer) deliverOffset.current = null;
      cancelPending.current();
      cleanup?.();
    };
  }, []);
  const scrollToFn = useCallback<typeof elementScroll<HTMLElement>>((offset, options, instance) => {
    // Core eagerly folds adjustments into scrollOffset even when this physical
    // write is withheld. Do not add a second anchor or replay each correction.
    if (!active.current) {
      const anchor = options.adjustments !== undefined;
      const observer = deliverOffset.current;
      const owner = selection.current;
      const element = instance.scrollElement;
      const count = instance.options.count;
      const margin = instance.options.scrollMargin;
      if (!anchor) {
        cancelPending.current();
        lastRelease.current = null;
      }
      elementScroll(offset, options, instance);
      // Core's ordinary size correction is not a keyboard/jump interruption.
      // Keep its fraction and recognize its native echo without losing input.
      if (anchor && element?.isConnected && deliverOffset.current === observer &&
          observer?.instance === instance && selection.current === owner &&
          instance.scrollElement === element && instance.options.count === count &&
          instance.options.scrollMargin === margin) {
        lastRelease.current = { element, physical: element.scrollTop, logical: offset + (options.adjustments ?? 0) };
      }
    }
  }, []);

  return { observeOffset, scrollToFn, active, committed, cancelPending, deliverOffset, lastRelease, selection, releaseListener, reportFailure, clearFailure };
}

export function useTranscriptWheelBoundary(instance: TranscriptVirtualizer,
  { active, cancelPending, deliverOffset, lastRelease, selection, releaseListener, reportFailure, clearFailure }: ReturnType<typeof useTranscriptWheelTransaction>) {
    // Scheduling survives listener replacement on unrelated React commits.
    // Retain only discrete normalized deltas, never DOM events or message lists.
    const pending = useRef<number[]>([]);
    const scheduled = useRef<{ window: Window; id: number } | null>(null);
    const epoch = useRef(0);
    const priorOwns = useRef<(() => boolean) | null>(null);
    const runFrame = useRef<() => void>(() => {});
    const cancel = useCallback(() => {
      epoch.current++;
      pending.current = [];
      if (scheduled.current) scheduled.current.window.cancelAnimationFrame(scheduled.current.id);
      scheduled.current = null;
    }, []);
    cancelPending.current = cancel;
    useLayoutEffect(() => () => {
      cancel();
      priorOwns.current = null;
      runFrame.current = () => {};
    }, [cancel]);
    // Like core's _willUpdate, resolve after every commit: OverlayScrollbars can
    // replace its viewport without changing getScrollElement's function identity.
    useLayoutEffect(() => {
      if (priorOwns.current && !priorOwns.current()) {
        cancel();
        lastRelease.current = null;
      }
      const scroller = instance.scrollElement;
      if (!scroller) return;
      const observer = deliverOffset.current;
      const owner = selection.current;
      const count = instance.options.count;
      const margin = instance.options.scrollMargin;

      const height = scroller.clientHeight;
      const width = scroller.clientWidth;
      const owns = () => deliverOffset.current === observer && observer?.instance === instance &&
        observer.element === scroller && instance.scrollElement === scroller && scroller.isConnected &&
        instance.options.getScrollElement() === scroller && selection.current === owner &&
        instance.options.count === count && instance.options.scrollMargin === margin &&
        scroller.clientHeight === height && scroller.clientWidth === width;
      priorOwns.current = owns;
      // True only after commit, actual coverage and physical release succeeded.
      const transact = (delta: number, lease: number): boolean => {
        const live = () => epoch.current === lease && owns();
        if (!observer || !live()) return false;
        const before = scroller.scrollTop;
        const previous = lastRelease.current;
        const base = previous?.element === scroller && previous.physical === before ? previous.logical : before;
        const target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, base + delta));
        const priorLogical = instance.scrollOffset ?? before;
        active.current = true;
        const normalOnChange = instance.options.onChange;
        const quietOnChange = (v: TranscriptVirtualizer) => normalOnChange(v, false);
        instance.setOptions({ ...instance.options, onChange: quietOnChange });
        const rollback = () => {
          if (!live()) return false;
          const onChange = instance.options.onChange;
          const quiet = (v: TranscriptVirtualizer) => onChange(v, false);
          instance.setOptions({ ...instance.options, onChange: quiet });
          try {
            flushSync(() => {
              observer.deliver(before, false);
              observer.deliver(priorLogical, false);
            });
          } finally {
            if (instance.options.onChange === quiet) instance.setOptions({ ...instance.options, onChange });
          }
          return live();
        };
        let renderFailure: unknown;
        const recordFailure = (error: ErrorEvent) => { renderFailure = error.error; };
        const window = scroller.ownerDocument.defaultView;
        window?.addEventListener("error", recordFailure);
        try {
          flushSync(() => {
            observer.deliver(before, true);
            if (live()) observer.deliver(target, true);
          });
          if (!live()) {
            if (renderFailure) console.error("Wheel transaction render failed", renderFailure);
            return false;
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
            if (rollback() && !renderFailure && live()) reportFailure();
            return false;
          }
          if (!live()) return false;
          elementScroll(destination, { behavior: "instant" }, instance);
          if (!live()) return false;
          lastRelease.current = { element: scroller, physical: scroller.scrollTop, logical: destination };
          clearFailure();
          return true;
        } catch (error) {
          let restored = false;
          try { restored = rollback(); }
          catch (rollbackError) { console.error("Wheel transaction rollback failed", rollbackError); }
          if (!renderFailure && live()) reportFailure();
          if (restored) throw error; // Original exception, only after recovery.
          console.error("Wheel transaction failed after owner disposal", error);
          return false;
        } finally {
          window?.removeEventListener("error", recordFailure);
          active.current = false;
          // Adapter renders may have installed a new callback (or selection).
          if (instance.options.onChange === quietOnChange) instance.setOptions({ ...instance.options, onChange: normalOnChange });
        }
      };
      const schedule = () => {
        const window = scroller.ownerDocument.defaultView;
        if (!window || scheduled.current || active.current || pending.current.length === 0) return;
        const lease = epoch.current;
        const id = window.requestAnimationFrame(() => {
          if (lease !== epoch.current) return;
          scheduled.current = null;
          runFrame.current();
        });
        scheduled.current = { window, id };
      };
      runFrame.current = () => {
        const lease = epoch.current;
        if (!owns()) { cancel(); return; }
        // Only the inputs present at frame entry belong to this batch. Inputs
        // arriving inside commit/release remain FIFO, but run in a later frame.
        const ready = pending.current.length;
        let released = 0;
        try {
          for (let i = 0; i < ready && lease === epoch.current && owns(); i++) {
            if (transact(pending.current.shift()!, lease)) released++;
          }
        } finally {
          if (!owns()) cancel();
          else schedule();
        }
        // One generic notification per whole, still-owned batch. Reentrant
        // input pending for a later frame makes that later batch the final one.
        if (ready === 0 || released !== ready || lease !== epoch.current || !owns() ||
            active.current || pending.current.length > 0) return;
        // The release already completed: report through the existing slot and
        // propagate the listener's own error, never roll back.
        try { releaseListener.current?.(); }
        catch (error) {
          reportFailure();
          throw error;
        }
      };
      const wheel = (event: WheelEvent) => {
        if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.shiftKey ||
            event.deltaX !== 0 || !Number.isFinite(event.deltaY) || event.deltaY === 0 || !owns()) return;
        const style = getComputedStyle(scroller);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
        const delta = event.deltaY * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? height : 1);
        if (!Number.isFinite(delta)) return;
        for (const node of event.composedPath()) {
          if (node === scroller) break;
          if (!(node instanceof HTMLElement)) continue;
          const overflow = getComputedStyle(node).overflowY;
          if (!/^(auto|scroll|overlay)$/.test(overflow) || node.scrollHeight <= node.clientHeight) continue;
          const canConsume = delta < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight;
          if (canConsume || /^(contain|none)$/.test(getComputedStyle(node).overscrollBehaviorY)) return;
        }
        const before = scroller.scrollTop;
        const previous = lastRelease.current;
        const base = active.current ? instance.scrollOffset ?? before :
          previous?.element === scroller && previous.physical === before ? previous.logical : before;
        const max = Math.max(0, scroller.scrollHeight - height);
        const clamp = (value: number) => Math.max(0, Math.min(max, value));
        const projected = pending.current.reduce((offset, input) => clamp(offset + input), base);
        if ((delta > 0 && projected >= max) || (delta < 0 && projected <= 0)) return;
        if (clamp(projected + delta) === projected) return;
        event.preventDefault();
        pending.current.push(delta);
        schedule();
      };
      const interrupt = () => {
        if (active.current) return;
        cancel();
        lastRelease.current = null;
      };
      scroller.addEventListener("wheel", wheel, { passive: false });
      scroller.addEventListener("keydown", interrupt);
      return () => {
        scroller.removeEventListener("wheel", wheel);
        scroller.removeEventListener("keydown", interrupt);
      };
    });
}
