/**
 * SessionMinimap Component
 *
 * A narrow canvas strip beside the message list that paints the whole
 * loaded session as colored blocks, one per row, plus a draggable viewport
 * box marking what is currently in view. See
 * `docs/specs/issue-599-session-minimap.md` for the design this implements;
 * this component is a thin painter, every pixel computation comes from
 * `helpers/minimapLayout.ts`.
 *
 * Mounted as a sibling of `FloatingDateOverlay` (a later build step); this
 * component does not itself decide whether it should be visible (Capture
 * Mode, narrow windows), the mount site does that with `useMinimapVisible`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Virtualizer, VirtualItem } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import type { FlattenedMessage } from "../types";
import { classifyMessage, isFailedTaskStatus, type MessageKind } from "../helpers/messageKinds";
import {
  bucketMinimapRows,
  barWidthForKind,
  minimapScale,
  scrollTopForStripY,
  viewportBox,
  type MinimapRow,
} from "../helpers/minimapLayout";
import { kindColorSource, minimapFailedColor } from "../helpers/kindColorSource";

/** The strip's fixed CSS width (Decision 8). The mount site pads the list by the same amount. */
export const MINIMAP_WIDTH_PX = 14;

interface SessionMinimapProps {
  virtualizer: Virtualizer<HTMLElement, Element>;
  flattenedMessages: FlattenedMessage[];
  virtualRows: VirtualItem[];
  totalSize: number;
  getScrollElement: () => HTMLElement | null;
}

/** One row's contribution to the strip, built from `flattenedMessages` (Design §1). */
function rowForItem(item: FlattenedMessage): MinimapRow {
  if (item.type !== "message") return { kind: null, failed: false };
  const info = classifyMessage(item.message);
  const failed = info.kind === "agent-update" && isFailedTaskStatus(info.notification?.status);
  return { kind: info.kind, failed };
}

export const SessionMinimap: React.FC<SessionMinimapProps> = React.memo(
  ({ virtualizer, flattenedMessages, virtualRows, totalSize, getScrollElement }) => {
    const stripRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [viewport, setViewport] = useState<{ top: number; height: number }>({ top: 0, height: 6 });

    // Memoized on `flattenedMessages` only, per the Performance budget:
    // `classifyMessage` parses text and runs a regex, so it must not run on
    // every redraw.
    const rows = useMemo<MinimapRow[]>(
      () => flattenedMessages.map(rowForItem),
      [flattenedMessages],
    );

    // The strip maps the whole scroll content, in scroll coordinates. Row
    // measurements start after the list header (the virtualizer's
    // `scrollMargin`), but `getTotalSize()` leaves that margin out, so the
    // scroll element's own height is the one scale that fits blocks, the
    // viewport box, and clicks alike.
    const getContentHeight = useCallback(() => {
      const scrollEl = getScrollElement();
      if (scrollEl && scrollEl.scrollHeight > 0) return scrollEl.scrollHeight;
      return (virtualizer.options?.scrollMargin ?? 0) + virtualizer.getTotalSize();
    }, [getScrollElement, virtualizer]);

    // How far below `scrollMargin` the list really starts. The measurements
    // assume the list begins right after the header, but anything else
    // rendered above it inside the scroll container (the dev-only debug
    // panel, the "no search results" notice) pushes it further down. Read
    // from the list element itself, the parent of any rendered row.
    const getListOffset = useCallback(() => {
      const scrollEl = getScrollElement();
      const list = scrollEl?.querySelector<HTMLElement>("[data-index]")?.parentElement;
      if (!scrollEl || !list) return 0;
      const listTop =
        list.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      return listTop - (virtualizer.options?.scrollMargin ?? 0);
    }, [getScrollElement, virtualizer]);

    const draw = useCallback(() => {
      const strip = stripRef.current;
      const canvas = canvasRef.current;
      if (!strip || !canvas) return;

      const cssWidth = strip.clientWidth;
      const cssHeight = strip.clientHeight;
      if (cssWidth <= 0 || cssHeight <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const backingWidth = Math.round(cssWidth * dpr);
      const backingHeight = Math.round(cssHeight * dpr);
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      // `getTotalSize()` first: it calls the virtualizer's memoized
      // `getMeasurements()` internally, which is what actually refreshes
      // `measurementsCache`. Reading the cache before that call can see the
      // previous render's array.
      virtualizer.getTotalSize();
      const measurements = virtualizer.measurementsCache;

      const winners = bucketMinimapRows({
        measurements,
        rows,
        totalSize: getContentHeight(),
        stripHeight: cssHeight,
        offset: getListOffset(),
      });

      // Colors are read fresh on every draw (Decision 4), but only once per
      // kind within one draw, not once per painted pixel row.
      const colors = new Map<string, string | null>();
      const colorFor = (kind: MessageKind, failed: boolean) => {
        const key = failed ? "failed" : kind;
        if (!colors.has(key)) {
          colors.set(key, failed ? minimapFailedColor() : kindColorSource.colorForKind(kind));
        }
        return colors.get(key) ?? null;
      };

      for (let y = 0; y < winners.length; y++) {
        const paint = winners[y];
        if (!paint) continue;

        const color = colorFor(paint.kind, paint.kind === "agent-update" && paint.failed);
        if (!color) continue;

        const width = barWidthForKind(paint.kind) * cssWidth;
        ctx.fillStyle = color;
        // Left-padded: the bar hugs the strip's right edge (Design §3).
        ctx.fillRect(cssWidth - width, y, width, 1);
      }
    }, [virtualizer, rows, getContentHeight, getListOffset]);

    // The pending frame calls the newest `draw`, so rows that arrive while a
    // frame is already pending are the ones it paints.
    const drawRef = useRef(draw);
    useEffect(() => {
      drawRef.current = draw;
    }, [draw]);

    // One redraw per animation frame, coalescing bursts of triggers (Design §3).
    const drawFrameRef = useRef<number | null>(null);
    const drawPendingRef = useRef(false);

    const scheduleDraw = useCallback(() => {
      if (drawPendingRef.current) return;
      drawPendingRef.current = true;
      drawFrameRef.current = requestAnimationFrame(() => {
        drawPendingRef.current = false;
        drawRef.current();
      });
    }, []);

    // Trigger: totalSize and virtualRows, the same values passed into
    // `FloatingDateOverlay`, plus `draw` itself, which changes with `rows`.
    useEffect(() => {
      scheduleDraw();
    }, [totalSize, virtualRows, draw, scheduleDraw]);

    // Viewport box: position from the scroll element, coalesced per frame (Design §6).
    const updateViewport = useCallback(() => {
      const strip = stripRef.current;
      const scrollEl = getScrollElement();
      if (!strip || !scrollEl) return;
      const scale = minimapScale(getContentHeight(), strip.clientHeight);
      setViewport(viewportBox(scrollEl.scrollTop, scrollEl.clientHeight, scale));
    }, [getScrollElement, getContentHeight]);

    // Trigger: a ResizeObserver on the strip itself. A resize also moves the
    // viewport box (its height and top both scale with the strip's own
    // height), not only the canvas painting, so both are kept in step here.
    useEffect(() => {
      const strip = stripRef.current;
      if (!strip) return;
      const observer = new ResizeObserver(() => {
        scheduleDraw();
        updateViewport();
      });
      observer.observe(strip);
      return () => observer.disconnect();
    }, [scheduleDraw, updateViewport]);

    // Trigger: theme/high-contrast toggles both flip a class on <html> (Design §5).
    useEffect(() => {
      const observer = new MutationObserver(() => scheduleDraw());
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    }, [scheduleDraw]);

    useEffect(
      () => () => {
        if (drawFrameRef.current != null) cancelAnimationFrame(drawFrameRef.current);
      },
      [],
    );

    const scrollFrameRef = useRef<number | null>(null);

    useEffect(() => {
      const scrollEl = getScrollElement();
      if (!scrollEl) return;

      // Scoped to this effect run, not a ref: re-running the effect (a new
      // `totalSize`, the retry signal below) must start with a clear flag.
      // A ref shared across runs would stay stuck at `true` forever once a
      // run's cleanup cancels its own in-flight frame before that frame's
      // callback got a chance to reset it.
      let pending = false;

      const handleScroll = () => {
        if (pending) return;
        pending = true;
        scrollFrameRef.current = requestAnimationFrame(() => {
          pending = false;
          updateViewport();
        });
      };

      scrollEl.addEventListener("scroll", handleScroll);
      updateViewport();

      return () => {
        scrollEl.removeEventListener("scroll", handleScroll);
        if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      };
      // `totalSize` as a retry signal: `getScrollElement` can still resolve
      // to null on the first pass (OverlayScrollbars not yet initialized).
    }, [getScrollElement, updateViewport, totalSize]);

    // Click centers the list on the clicked point; drag (pointerdown + capture,
    // then every pointermove) scrolls continuously (Design §6). Neither uses
    // `navigateToMessage` or `scrollToIndex`, on purpose: those fight a drag.
    const scrollToStripY = useCallback(
      (clientY: number) => {
        const strip = stripRef.current;
        const scrollEl = getScrollElement();
        if (!strip || !scrollEl) return;
        const rect = strip.getBoundingClientRect();
        const y = clientY - rect.top;
        const scale = minimapScale(getContentHeight(), strip.clientHeight);
        scrollEl.scrollTop = scrollTopForStripY(y, scale, scrollEl.clientHeight, scrollEl.scrollHeight);
      },
      [getScrollElement, getContentHeight],
    );

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => scrollToStripY(event.clientY),
      [scrollToStripY],
    );

    const draggingRef = useRef(false);

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      const strip = stripRef.current;
      draggingRef.current = true;
      if (strip && typeof strip.setPointerCapture === "function") {
        try {
          strip.setPointerCapture(event.pointerId);
        } catch {
          // Not implemented in this environment (e.g. jsdom); dragging still
          // works via pointermove on the strip itself.
        }
      }
    }, []);

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        scrollToStripY(event.clientY);
      },
      [scrollToStripY],
    );

    const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      const strip = stripRef.current;
      if (strip && typeof strip.releasePointerCapture === "function") {
        try {
          strip.releasePointerCapture(event.pointerId);
        } catch {
          // Already released, or not implemented in this environment.
        }
      }
    }, []);

    return (
      <div
        ref={stripRef}
        aria-hidden="true"
        data-testid="session-minimap"
        className={cn("absolute top-0 right-0 h-full cursor-pointer select-none")}
        style={{ width: MINIMAP_WIDTH_PX }}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <div
          data-testid="session-minimap-viewport"
          className="pointer-events-none absolute left-0 right-0 bg-foreground/15"
          style={{ top: viewport.top, height: viewport.height }}
        />
      </div>
    );
  },
);

SessionMinimap.displayName = "SessionMinimap";
