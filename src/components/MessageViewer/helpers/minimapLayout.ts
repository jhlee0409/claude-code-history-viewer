import type { MessageKind } from "./messageKinds";

/**
 * Pure math for the session minimap strip: no DOM, no canvas, no React.
 * `SessionMinimap` (Build order step 4) is a thin painter over this module's
 * output, which is why every rule from Design §3, §4, and §6 of
 * `docs/specs/issue-599-session-minimap.md` lives here instead.
 */

/** Design §4's priority table, higher wins a pixel shared with a lower one. */
export const MINIMAP_KIND_PRIORITY: Record<MessageKind, number> = {
  prompt: 8,
  command: 7,
  "agent-update": 6,
  summary: 5,
  reply: 4,
  tool: 3,
  context: 2,
  system: 1,
};

/** Priority for a kind, per Design §4. The default `priorityForKind` for `bucketMinimapRows`. */
export function priorityForKind(kind: MessageKind): number {
  return MINIMAP_KIND_PRIORITY[kind];
}

/**
 * Bar width per kind as a fraction of the full bar (Design §3, "a width
 * proportional to that kind's visual weight"). These are the prototype's
 * `PAINT` weights, mapped onto the real kinds: prompt widest, tool calls and
 * injected rows narrowest.
 */
export const MINIMAP_KIND_BAR_WIDTH: Record<MessageKind, number> = {
  prompt: 1,
  command: 0.7,
  "agent-update": 0.8,
  summary: 0.9,
  reply: 0.7,
  tool: 0.5,
  context: 0.4,
  system: 0.4,
};

/**
 * Paint strength per kind (Design §3). The prototype paints replies and tool
 * calls in dim colors so prompts and agent updates stand out; the painter
 * gets the same effect from the theme's own tokens by lowering
 * `globalAlpha` over the strip's background.
 */
export const MINIMAP_KIND_ALPHA: Record<MessageKind, number> = {
  prompt: 1,
  command: 1,
  "agent-update": 1,
  summary: 1,
  reply: 0.55,
  tool: 0.3,
  context: 0.25,
  system: 0.25,
};

/** Paint strength for a kind, per Design §3. */
export function alphaForKind(kind: MessageKind): number {
  return MINIMAP_KIND_ALPHA[kind];
}

/** Every bar starts this far from the strip's left edge, as in the prototype. */
export const MINIMAP_BAR_PAD_PX = 5;

/** Kept empty on the strip's right for PR 2's search ticks (prototype: a 5px ruler plus 2px). */
export const MINIMAP_TICK_GUTTER_PX = 7;

/** The prototype never paints a bar narrower than this. */
const MIN_BAR_WIDTH_PX = 3;

/**
 * Where one pixel row's bar goes, per the prototype's `draw()`: left-aligned
 * at the pad, `max(3, barW * weight)` wide, where `barW` is the strip width
 * less the pad on both sides and the tick gutter.
 */
export function minimapBarRect(kind: MessageKind, stripWidth: number): { x: number; width: number } {
  const fullBar = Math.max(
    MIN_BAR_WIDTH_PX,
    stripWidth - MINIMAP_BAR_PAD_PX * 2 - MINIMAP_TICK_GUTTER_PX,
  );
  return {
    x: MINIMAP_BAR_PAD_PX,
    width: Math.max(MIN_BAR_WIDTH_PX, fullBar * MINIMAP_KIND_BAR_WIDTH[kind]),
  };
}

/**
 * Design §5's color seam. `kindColorSource` (built alongside `SessionMinimap`)
 * is the only PR 1 implementation; a token-cost mode (issue #570) is a
 * plausible second one that reorders priority without touching bucketing.
 */
export interface MinimapColorSource {
  /** CSS color for this row's kind, or null to leave the pixel unpainted. */
  colorForKind(kind: MessageKind): string | null;
  /** Priority for this row; higher wins a pixel shared with a lower one. */
  priorityForKind(kind: MessageKind): number;
}

/** One flattened row's contribution to the strip: its kind, or null for rows that paint nothing. */
export interface MinimapRow {
  kind: MessageKind | null;
  failed: boolean;
}

/** The winning paint for one output pixel row. */
export interface MinimapPaint {
  kind: MessageKind;
  failed: boolean;
}

/** The shape of one `measurementsCache` entry the layout helper needs. */
export interface MinimapMeasurement {
  start: number;
  size: number;
}

export interface BucketMinimapRowsArgs {
  /** Same length and index alignment as `rows`; a shorter array is fine, the rest are treated as unkinded. */
  measurements: readonly MinimapMeasurement[];
  /** Same index alignment as `measurements`. */
  rows: readonly MinimapRow[];
  /** The height the strip maps onto: the scroll content's height. */
  totalSize: number;
  /** The strip's height in CSS pixels; also the length of the returned array. */
  stripHeight: number;
  /** Added to every `start`, for content rendered above the list that the measurements leave out. */
  offset?: number;
  /** Injectable so an alternate color source (Design §5) can reorder without touching this function. */
  priorityForKind?: (kind: MessageKind) => number;
}

/**
 * One winning paint per output pixel row, or null where no row claims that
 * pixel (Design §3-4). `y0`/`y1` follow Design §3 exactly; a `prompt` row is
 * forced to at least 2px so it never disappears at low zoom (Acceptance #3).
 * Rows measuring at size 0 (collapsed agent task group members, Verified
 * constraints) are skipped outright: `floor` and `ceil` on a zero-length span
 * can still open a one-pixel window, which would let an invisible row win a
 * pixel a real row could use.
 */
export function bucketMinimapRows(args: BucketMinimapRowsArgs): (MinimapPaint | null)[] {
  const {
    measurements,
    rows,
    totalSize,
    stripHeight,
    offset = 0,
    priorityForKind: priorityFn = priorityForKind,
  } = args;

  const height = Math.max(0, Math.floor(stripHeight));
  const winners: (MinimapPaint | null)[] = new Array(height).fill(null);
  const winnerPriority: number[] = new Array(height).fill(-Infinity);

  if (totalSize <= 0 || height === 0) return winners;

  const scale = height / totalSize;

  for (let index = 0; index < measurements.length; index++) {
    const measurement = measurements[index];
    if (measurement == null || measurement.size <= 0) continue;

    const row = rows[index];
    const kind = row?.kind ?? null;
    if (kind == null || row == null) continue;

    const priority = priorityFn(kind);

    const start = measurement.start + offset;
    let y0 = Math.floor(start * scale);
    let y1 = Math.ceil((start + measurement.size) * scale);
    if (kind === "prompt") y1 = Math.max(y1, y0 + 2);

    y1 = Math.min(height, y1);
    // At the strip's end the minimum grows upward instead of being clipped.
    if (kind === "prompt") y0 = Math.min(y0, y1 - 2);
    y0 = Math.max(0, y0);

    for (let y = y0; y < y1; y++) {
      const existingPriority = winnerPriority[y] ?? -Infinity;
      if (priority > existingPriority) {
        winnerPriority[y] = priority;
        winners[y] = { kind, failed: row.failed };
      }
    }
  }

  return winners;
}

/** `stripHeightPx / totalSize`, zero (not NaN or Infinity) when `totalSize` is zero. */
export function minimapScale(totalSize: number, stripHeight: number): number {
  if (totalSize <= 0) return 0;
  return stripHeight / totalSize;
}

/** The viewport box's position and height on the strip, per Design §6. */
export function viewportBox(
  scrollTop: number,
  clientHeight: number,
  scale: number,
): { top: number; height: number } {
  return {
    top: scrollTop * scale,
    height: Math.max(6, clientHeight * scale),
  };
}

/**
 * Click-to-center: the scroll offset that centers the list on strip
 * y-coordinate `y`, clamped to a valid scroll range (Design §6). Zero `scale`
 * (an empty session) returns 0 rather than dividing by zero.
 */
export function scrollTopForStripY(
  y: number,
  scale: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  if (scale <= 0) return 0;
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const scrollTop = y / scale - clientHeight / 2;
  return Math.min(maxScrollTop, Math.max(0, scrollTop));
}

/** The inverse of `scrollTopForStripY`: the strip y-coordinate for a given scroll offset. */
export function stripYForScrollTop(scrollTop: number, scale: number, clientHeight: number): number {
  return (scrollTop + clientHeight / 2) * scale;
}
