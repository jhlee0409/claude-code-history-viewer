/**
 * SessionMinimap Component
 *
 * A narrow canvas strip beside the message list that paints the whole
 * loaded session as colored blocks, one per row, plus a draggable viewport
 * box marking what is currently in view. PR 2 adds a not-loaded band at the
 * top for older pages, search-match ticks in the right gutter, and a hover
 * preview of the row under the pointer. See
 * `docs/specs/issue-599-session-minimap.md` for the design this implements;
 * this component is a thin painter, every pixel computation comes from
 * `helpers/minimapLayout.ts`.
 *
 * Mounted next to the message list; this component does not itself decide
 * whether it should be visible (Capture Mode, narrow windows), the mount
 * site does that with `useMinimapVisible`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Virtualizer, VirtualItem } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { getToolUseBlock } from "@/utils/messageUtils";
import { previewText, truncatePreview } from "@/components/MessageNavigator/classifiedRows";
import { getKindLabelKey } from "@/components/MessageNavigator/kindLabels";
import type { FlattenedMessage } from "../types";
import { classifyMessage, isFailedTaskStatus, type MessageKind } from "../helpers/messageKinds";
import {
  alphaForKind,
  bucketMinimapRows,
  minimapBarRect,
  minimapGeometry,
  minimapTicks,
  minimapTickX,
  MINIMAP_TICK_WIDTH_PX,
  rowIndexAtOffset,
  scrollTopForStripY,
  viewportBox,
  type MinimapRow,
} from "../helpers/minimapLayout";
import { kindColorSource, minimapFailedColor, minimapTickColors } from "../helpers/kindColorSource";

/** The strip's fixed CSS width (Decision 8). The mount site pads the list by the same amount. */
export const MINIMAP_WIDTH_PX = 64;

/** The band shows its unloaded count only when at least this tall. */
const BAND_LABEL_MIN_PX = 14;

/** The prototype's "not loaded yet" hatching, in the theme's muted text color. */
const BAND_HATCH =
  "repeating-linear-gradient(135deg, var(--muted-foreground) 0 2px, transparent 2px 6px)";

/** Hover snippets are cut at this many characters (spec, PR 2 acceptance 9). */
const HOVER_SNIPPET_MAX = 120;

/** The tooltip sits this far above the pointer, and keeps this much room at the strip's bottom. */
const TOOLTIP_LIFT_PX = 16;
const TOOLTIP_BOTTOM_ROOM_PX = 60;

interface SessionMinimapProps {
  virtualizer: Virtualizer<HTMLElement, Element>;
  flattenedMessages: FlattenedMessage[];
  virtualRows: VirtualItem[];
  totalSize: number;
  getScrollElement: () => HTMLElement | null;
  /** PR 2 search ticks: uuids of matched messages, one tick each. */
  matchedUuids?: ReadonlySet<string>;
  /** PR 2 search ticks: the current match's message, drawn taller. */
  currentMatchUuid?: string | null;
  /** Resolves a matched uuid to its row in `flattenedMessages`. */
  uuidToIndexMap?: ReadonlyMap<string, number>;
  /** Matches in unloaded pages; they draw no tick, and the band's tooltip counts them. */
  notLoadedMatchCount?: number;
  /** PR 2 not-loaded band: `pagination.hasMore`. */
  hasMore?: boolean;
  /** `pagination.isLoadingMore`: the band pulses and ignores clicks. */
  isLoadingMore?: boolean;
  /** Messages not loaded yet: `totalCount - currentOffset`. */
  unloadedCount?: number;
  /** `pagination.totalCount`. */
  totalCount?: number;
  /** The list's own load-earlier handler, which keeps the reader's place. */
  onLoadEarlier?: () => void;
}

/** One row's contribution to the strip, built from `flattenedMessages` (Design §1). */
function rowForItem(item: FlattenedMessage): MinimapRow {
  if (item.type !== "message") return { kind: null, failed: false };
  const info = classifyMessage(item.message);
  const failed = info.kind === "agent-update" && isFailedTaskStatus(info.notification?.status);
  return { kind: info.kind, failed };
}

/** Hours and minutes, as the Messages panel shows a row's time; empty when unknown. */
function formatHoverTime(timestamp: string | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** What the pointer is over: a row index, or the not-loaded band. */
type HoverTarget = number | "band";

export const SessionMinimap: React.FC<SessionMinimapProps> = React.memo(
  ({
    virtualizer,
    flattenedMessages,
    virtualRows,
    totalSize,
    getScrollElement,
    matchedUuids,
    currentMatchUuid = null,
    uuidToIndexMap,
    notLoadedMatchCount = 0,
    hasMore = false,
    isLoadingMore = false,
    unloadedCount = 0,
    totalCount = 0,
    onLoadEarlier,
  }) => {
    const { t } = useTranslation();
    const stripRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // The viewport box and the band, both placed from one geometry read.
    const [layout, setLayout] = useState({ boxTop: 0, boxHeight: 6, bandHeight: 0 });
    const [hover, setHover] = useState<{ target: HoverTarget; top: number } | null>(null);

    // Memoized on `flattenedMessages` only, per the Performance budget:
    // `classifyMessage` parses text and runs a regex, so it must not run on
    // every redraw.
    const rows = useMemo<MinimapRow[]>(
      () => flattenedMessages.map(rowForItem),
      [flattenedMessages],
    );

    // Matched rows, resolved by uuid: `SearchMatch.messageIndex` indexes the
    // full session, not these rows. A uuid with no row (an unloaded page, or
    // a row the display filter hides) gets no tick.
    const tickRows = useMemo(() => {
      const indices: number[] = [];
      if (matchedUuids && uuidToIndexMap) {
        for (const uuid of matchedUuids) {
          const index = uuidToIndexMap.get(uuid);
          if (index !== undefined) indices.push(index);
        }
      }
      const current =
        currentMatchUuid != null ? (uuidToIndexMap?.get(currentMatchUuid) ?? -1) : -1;
      return { indices, current };
    }, [matchedUuids, uuidToIndexMap, currentMatchUuid]);

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

    // Where the band ends and the session map begins, for a strip this tall.
    const getGeometry = useCallback(
      (stripHeight: number) =>
        minimapGeometry({
          stripHeight,
          contentHeight: getContentHeight(),
          hasMore,
          unloadedCount,
          totalCount,
        }),
      [getContentHeight, hasMore, unloadedCount, totalCount],
    );

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

      const geometry = getGeometry(cssHeight);
      const listOffset = getListOffset();

      const winners = bucketMinimapRows({
        measurements,
        rows,
        totalSize: getContentHeight(),
        stripHeight: geometry.mapHeight,
        offset: listOffset,
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

        // Left-aligned at the pad, the right gutter left free (Design §3).
        const { x, width } = minimapBarRect(paint.kind, cssWidth);
        ctx.fillStyle = color;
        ctx.globalAlpha = alphaForKind(paint.kind);
        ctx.fillRect(x, geometry.mapTop + y, width, 1);
      }
      ctx.globalAlpha = 1;

      // Search ticks in the right gutter, the current match last so it
      // paints over its neighbors (spec, PR 2 design).
      if (tickRows.indices.length === 0 && tickRows.current < 0) return;
      const ticks = minimapTicks({
        rowIndices: tickRows.indices,
        currentRowIndex: tickRows.current,
        measurements,
        scale: geometry.scale,
        offset: listOffset,
        mapHeight: geometry.mapHeight,
      });
      if (ticks.length === 0) return;

      const tickColors = minimapTickColors();
      if (!tickColors.tick) return;
      const tickX = minimapTickX(cssWidth);
      for (const tick of ticks) {
        const y = geometry.mapTop + tick.y;
        ctx.fillStyle = tickColors.tick;
        if (tick.current) {
          // A 1px outline in the mark's text color, then the current-match fill inside it.
          ctx.fillRect(tickX - 1, y - 1, MINIMAP_TICK_WIDTH_PX + 2, tick.height + 2);
          ctx.fillStyle = tickColors.current || tickColors.tick;
        }
        ctx.fillRect(tickX, y, MINIMAP_TICK_WIDTH_PX, tick.height);
      }
    }, [virtualizer, rows, tickRows, getContentHeight, getListOffset, getGeometry]);

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
    // `CurrentDateBar`, plus `draw` itself, which changes with `rows`,
    // the search ticks, and the band's geometry.
    useEffect(() => {
      scheduleDraw();
    }, [totalSize, virtualRows, draw, scheduleDraw]);

    // Viewport box and band: placed from the scroll element, coalesced per
    // frame (Design §6). The box starts below the band.
    const updateViewport = useCallback(() => {
      const strip = stripRef.current;
      const scrollEl = getScrollElement();
      if (!strip || !scrollEl) return;
      const geometry = getGeometry(strip.clientHeight);
      const box = viewportBox(scrollEl.scrollTop, scrollEl.clientHeight, geometry.scale, geometry.mapTop);
      setLayout((prev) =>
        prev.boxTop === box.top && prev.boxHeight === box.height && prev.bandHeight === geometry.bandHeight
          ? prev
          : { boxTop: box.top, boxHeight: box.height, bandHeight: geometry.bandHeight },
      );
    }, [getScrollElement, getGeometry]);

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
    // Both map onto the region below the band.
    const scrollToStripY = useCallback(
      (clientY: number) => {
        const strip = stripRef.current;
        const scrollEl = getScrollElement();
        if (!strip || !scrollEl) return;
        const rect = strip.getBoundingClientRect();
        const geometry = getGeometry(strip.clientHeight);
        const y = clientY - rect.top - geometry.mapTop;
        scrollEl.scrollTop = scrollTopForStripY(
          y,
          geometry.scale,
          scrollEl.clientHeight,
          scrollEl.scrollHeight,
        );
      },
      [getScrollElement, getGeometry],
    );

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => scrollToStripY(event.clientY),
      [scrollToStripY],
    );

    const draggingRef = useRef(false);

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      const strip = stripRef.current;
      draggingRef.current = true;
      setHover(null);
      if (strip && typeof strip.setPointerCapture === "function") {
        try {
          strip.setPointerCapture(event.pointerId);
        } catch {
          // Not implemented in this environment (e.g. jsdom); dragging still
          // works via pointermove on the strip itself.
        }
      }
    }, []);

    // What the pointer is over, and where its tooltip goes. The row lookup
    // inverts the painter's mapping: strip y -> scroll content -> measurement.
    const hoverAt = useCallback(
      (clientY: number): { target: HoverTarget; top: number } | null => {
        const strip = stripRef.current;
        if (!strip) return null;
        const stripHeight = strip.clientHeight;
        const y = clientY - strip.getBoundingClientRect().top;
        const top = Math.max(0, Math.min(y - TOOLTIP_LIFT_PX, stripHeight - TOOLTIP_BOTTOM_ROOM_PX));

        const geometry = getGeometry(stripHeight);
        if (y < geometry.bandHeight) return { target: "band", top };
        if (geometry.scale <= 0) return null;

        // Refreshes `measurementsCache`, as in `draw`.
        virtualizer.getTotalSize();
        const offset = (y - geometry.mapTop) / geometry.scale - getListOffset();
        const index = rowIndexAtOffset(virtualizer.measurementsCache, offset);
        if (index < 0 || rows[index]?.kind == null) return null;
        return { target: index, top };
      },
      [getGeometry, getListOffset, virtualizer, rows],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (draggingRef.current) {
          scrollToStripY(event.clientY);
          return;
        }
        const next = hoverAt(event.clientY);
        // Returning `prev` skips the re-render when nothing moved.
        setHover((prev) => {
          if (!next) return prev === null ? prev : null;
          if (prev && prev.target === next.target && prev.top === next.top) return prev;
          return next;
        });
      },
      [scrollToStripY, hoverAt],
    );

    const handlePointerLeave = useCallback(() => setHover(null), []);

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

    // The band loads one older page through the list's own handler, which
    // keeps the reader's place (decision P2-2). A press on it never drags.
    const stopBandPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
    }, []);

    const handleBandClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (isLoadingMore) return;
        onLoadEarlier?.();
      },
      [isLoadingMore, onLoadEarlier],
    );

    // Tooltip text, recomputed only when the hovered target changes, not on
    // every pointer move: `previewText` runs regexes.
    const hoverTarget = hover?.target ?? null;
    const tooltip = useMemo<{ title: string; lines: string[] } | null>(() => {
      if (hoverTarget === null) return null;

      if (hoverTarget === "band") {
        const lines: string[] = [];
        if (!isLoadingMore && unloadedCount > 0) {
          lines.push(t("messageViewer.minimap.notLoadedBody", { count: unloadedCount }));
        }
        if (notLoadedMatchCount > 0) {
          lines.push(t("messageViewer.minimap.matchesNotLoaded", { count: notLoadedMatchCount }));
        }
        return {
          title: isLoadingMore ? t("common.loading") : t("messageViewer.minimap.notLoadedTitle"),
          lines,
        };
      }

      const item = flattenedMessages[hoverTarget];
      if (item?.type !== "message") return null;
      const info = classifyMessage(item.message);
      const toolName = getToolUseBlock(item.message)?.name || undefined;
      const snippet = truncatePreview(previewText(info, toolName), HOVER_SNIPPET_MAX);
      const label = t(getKindLabelKey(info.kind));
      const time = formatHoverTime(item.message.timestamp);
      return { title: time ? `${label} · ${time}` : label, lines: snippet ? [snippet] : [] };
    }, [hoverTarget, flattenedMessages, isLoadingMore, unloadedCount, notLoadedMatchCount, t]);

    const showBand = hasMore && layout.bandHeight > 0;

    return (
      <div
        ref={stripRef}
        aria-hidden="true"
        data-testid="session-minimap"
        className={cn(
          "absolute top-0 right-0 h-full cursor-pointer select-none border-l border-border bg-muted/40",
        )}
        style={{ width: MINIMAP_WIDTH_PX }}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {showBand && (
          <div
            data-testid="session-minimap-band"
            className={cn(
              "absolute inset-x-0 top-0 flex items-center justify-center overflow-hidden border-b border-border",
              isLoadingMore ? "cursor-progress animate-pulse" : "cursor-pointer",
            )}
            style={{ height: layout.bandHeight }}
            onPointerDown={stopBandPointer}
            onClick={handleBandClick}
          >
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: BAND_HATCH }} />
            {layout.bandHeight >= BAND_LABEL_MIN_PX && unloadedCount > 0 && (
              <span className="relative rounded-sm bg-background/80 px-1 text-[10px] font-medium leading-tight tabular-nums text-muted-foreground">
                {unloadedCount.toLocaleString()}
              </span>
            )}
          </div>
        )}
        <div
          data-testid="session-minimap-viewport"
          className="pointer-events-none absolute left-0 right-0 border-y border-foreground/30 bg-foreground/[0.12]"
          style={{ top: layout.boxTop, height: layout.boxHeight }}
        />
        {hover && tooltip && (
          <div
            data-testid="session-minimap-tooltip"
            className="pointer-events-none absolute right-full z-20 mr-2 w-max max-w-[280px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-md"
            style={{ top: hover.top }}
          >
            <span className="mb-0.5 block text-[11px] font-semibold text-muted-foreground">
              {tooltip.title}
            </span>
            {tooltip.lines.map((line, index) => (
              <span key={index} className="block break-words">
                {line}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  },
);

SessionMinimap.displayName = "SessionMinimap";
