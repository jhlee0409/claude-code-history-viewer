import { describe, expect, it } from "vitest";
import {
  alphaForKind,
  bucketMinimapRows,
  minimapBandHeight,
  minimapBarRect,
  minimapGeometry,
  minimapTicks,
  minimapTickX,
  MINIMAP_BAND_MAX_SHARE,
  MINIMAP_BAND_MIN_PX,
  MINIMAP_BAR_PAD_PX,
  MINIMAP_CURRENT_TICK_HEIGHT_PX,
  MINIMAP_TICK_GUTTER_PX,
  MINIMAP_TICK_HEIGHT_PX,
  MINIMAP_TICK_WIDTH_PX,
  minimapScale,
  priorityForKind,
  rowIndexAtOffset,
  scrollTopForStripY,
  stripYForScrollTop,
  viewportBox,
  type MinimapRow,
} from "./minimapLayout";
import type { MessageKind } from "./messageKinds";

/** A measurement row the way `measurementsCache` shapes it: `start` and `size` only. */
const measurement = (start: number, size: number) => ({ start, size });

/** A minimap row with a kind and no failure, the common case in these fixtures. */
const kindRow = (kind: MessageKind | null): MinimapRow => ({ kind, failed: false });

describe("bucketMinimapRows", () => {
  it("buckets a synthetic measurements array into one winner per output pixel", () => {
    const measurements = [measurement(0, 50), measurement(50, 50)];
    const rows = [kindRow("prompt"), kindRow("reply")];
    const winners = bucketMinimapRows({
      measurements,
      rows,
      totalSize: 100,
      stripHeight: 10,
    });
    expect(winners).toHaveLength(10);
    expect(winners[0]).toEqual({ kind: "prompt", failed: false });
    expect(winners[9]).toEqual({ kind: "reply", failed: false });
  });

  it("gives the pixel to the higher-priority kind when prompt and reply share it", () => {
    // 10,000 rows of size 20 scaled to a 100px strip: each row is ~0.01px, far
    // under a pixel, so index 0 (prompt) and index 1 (reply) both land on
    // pixel 0. Prompt's own 2px minimum extends it onto pixel 1 as well.
    const rowCount = 10_000;
    const rowSize = 20;
    const totalSize = rowCount * rowSize;
    const stripHeight = 100;
    const measurements = Array.from({ length: rowCount }, (_, i) => measurement(i * rowSize, rowSize));
    const rows: MinimapRow[] = measurements.map((_, i) => kindRow(i === 0 ? "prompt" : "reply"));

    const winners = bucketMinimapRows({ measurements, rows, totalSize, stripHeight });

    expect(winners[0]).toEqual({ kind: "prompt", failed: false });
    expect(winners[1]).toEqual({ kind: "prompt", failed: false });
  });

  it("gives the pixel to command over tool when they share it", () => {
    const measurements = [measurement(0, 1), measurement(0, 1)];
    const rows = [kindRow("tool"), kindRow("command")];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 1, stripHeight: 1 });
    expect(winners[0]?.kind).toBe("command");
  });

  it("keeps the existing winner when two rows of the same kind share a pixel (strict greater-than)", () => {
    const measurements = [measurement(0, 1), measurement(0, 1)];
    const rows = [kindRow("reply"), kindRow("reply")];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 1, stripHeight: 1 });
    // The first row keeps the pixel; priority ties do not hand it to the later row.
    expect(winners[0]).toEqual({ kind: "reply", failed: false });
  });

  it("carries the failed flag from the winning row without changing its priority", () => {
    const measurements = [measurement(0, 1)];
    const rows: MinimapRow[] = [{ kind: "agent-update", failed: true }];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 1, stripHeight: 1 });
    expect(winners[0]).toEqual({ kind: "agent-update", failed: true });
  });

  it("applies the prompt 2px minimum when the average row is under 1px", () => {
    // 1000 rows of size 1 scaled to a 10px strip: each row averages 0.01px.
    const measurements = Array.from({ length: 1000 }, (_, i) => measurement(i, 1));
    const rows: MinimapRow[] = measurements.map((_, i) => kindRow(i === 500 ? "prompt" : null));
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 1000, stripHeight: 10 });
    const promptPixels = winners.filter((w) => w?.kind === "prompt").length;
    expect(promptPixels).toBeGreaterThanOrEqual(2);
  });

  it("keeps the prompt 2px minimum on the strip's last pixel row", () => {
    // The last row's natural span is the final pixel; the minimum must grow
    // upward, since growing downward would be clipped by the strip's end.
    const measurements = Array.from({ length: 1000 }, (_, i) => measurement(i, 1));
    const rows: MinimapRow[] = measurements.map((_, i) => kindRow(i === 999 ? "prompt" : null));
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 1000, stripHeight: 100 });
    expect(winners.filter((w) => w?.kind === "prompt")).toHaveLength(2);
    expect(winners[99]?.kind).toBe("prompt");
  });

  it("shifts every row down by `offset`, for content rendered above the list", () => {
    const measurements = [measurement(0, 10)];
    const winners = bucketMinimapRows({
      measurements,
      rows: [kindRow("reply")],
      totalSize: 100,
      stripHeight: 100,
      offset: 50,
    });
    expect(winners[49]).toBeNull();
    expect(winners[50]?.kind).toBe("reply");
    expect(winners[59]?.kind).toBe("reply");
    expect(winners[60]).toBeNull();
  });

  it("paints nothing for null rows (date dividers, hidden placeholders)", () => {
    const measurements = [measurement(0, 10)];
    const rows: MinimapRow[] = [{ kind: null, failed: false }];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 10, stripHeight: 10 });
    expect(winners.every((w) => w === null)).toBe(true);
  });

  it("skips zero-size rows instead of letting them claim a pixel", () => {
    const measurements = [measurement(5, 0), measurement(0, 10)];
    const rows: MinimapRow[] = [kindRow("prompt"), kindRow("tool")];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 10, stripHeight: 10 });
    // The zero-size prompt row must not win any pixel; only the real tool row paints.
    expect(winners.some((w) => w?.kind === "prompt")).toBe(false);
  });

  it("returns an all-null array without dividing by zero when total size is zero", () => {
    const measurements = [measurement(0, 0)];
    const rows: MinimapRow[] = [kindRow("prompt")];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 0, stripHeight: 10 });
    expect(winners).toHaveLength(10);
    expect(winners.every((w) => w === null)).toBe(true);
  });

  it("treats a measurement with no matching row as unkinded", () => {
    const measurements = [measurement(0, 10), measurement(10, 10)];
    const rows: MinimapRow[] = [kindRow("tool")];
    const winners = bucketMinimapRows({ measurements, rows, totalSize: 20, stripHeight: 2 });
    expect(winners[0]?.kind).toBe("tool");
    expect(winners[1]).toBeNull();
  });

  it("accepts an injected priorityForKind so an alternate color source can reorder", () => {
    const measurements = [measurement(0, 1), measurement(0, 1)];
    const rows = [kindRow("reply"), kindRow("tool")];
    const winners = bucketMinimapRows({
      measurements,
      rows,
      totalSize: 1,
      stripHeight: 1,
      priorityForKind: (kind) => (kind === "tool" ? 100 : 0),
    });
    expect(winners[0]?.kind).toBe("tool");
  });
});

describe("priorityForKind (Design §4 table)", () => {
  it("ranks prompt above command above agent-update above summary above reply above tool above context above system", () => {
    expect(priorityForKind("prompt")).toBeGreaterThan(priorityForKind("command"));
    expect(priorityForKind("command")).toBeGreaterThan(priorityForKind("agent-update"));
    expect(priorityForKind("agent-update")).toBeGreaterThan(priorityForKind("summary"));
    expect(priorityForKind("summary")).toBeGreaterThan(priorityForKind("reply"));
    expect(priorityForKind("reply")).toBeGreaterThan(priorityForKind("tool"));
    expect(priorityForKind("tool")).toBeGreaterThan(priorityForKind("context"));
    expect(priorityForKind("context")).toBeGreaterThan(priorityForKind("system"));
  });
});

const ALL_KINDS: MessageKind[] = [
  "prompt", "command", "agent-update", "summary", "reply", "tool", "context", "system",
];

describe("minimapBarRect (the prototype's bar geometry)", () => {
  // The prototype draws every bar from a 5px left pad and keeps a 7px gutter
  // on the right for PR 2's search ticks: barW = W - pad * 2 - gutter.
  const fullBar = (width: number) => width - MINIMAP_BAR_PAD_PX * 2 - MINIMAP_TICK_GUTTER_PX;

  it("starts every bar at the left pad, not at the right edge", () => {
    for (const kind of ALL_KINDS) {
      expect(minimapBarRect(kind, 48).x).toBe(MINIMAP_BAR_PAD_PX);
    }
  });

  it("gives a prompt the full bar width and scales other kinds by the prototype's weights", () => {
    expect(minimapBarRect("prompt", 48).width).toBe(fullBar(48));
    expect(minimapBarRect("reply", 48).width).toBeCloseTo(fullBar(48) * 0.7);
    expect(minimapBarRect("tool", 48).width).toBeCloseTo(fullBar(48) * 0.5);
    expect(minimapBarRect("agent-update", 64).width).toBeCloseTo(fullBar(64) * 0.8);
  });

  it("never paints into the right gutter reserved for search ticks", () => {
    for (const width of [32, 48, 64]) {
      for (const kind of ALL_KINDS) {
        const rect = minimapBarRect(kind, width);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width - MINIMAP_TICK_GUTTER_PX);
      }
    }
  });

  it("keeps every bar at least 3px wide, as the prototype does", () => {
    for (const kind of ALL_KINDS) {
      expect(minimapBarRect(kind, 24).width).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("alphaForKind (the prototype's visual weight)", () => {
  it("paints prompts, commands, agent updates, and summaries at full strength", () => {
    for (const kind of ["prompt", "command", "agent-update", "summary"] as MessageKind[]) {
      expect(alphaForKind(kind)).toBe(1);
    }
  });

  it("dims replies, and dims tool calls and injected rows further, so they recede", () => {
    expect(alphaForKind("reply")).toBeLessThan(1);
    expect(alphaForKind("tool")).toBeLessThan(alphaForKind("reply"));
    expect(alphaForKind("context")).toBeLessThanOrEqual(alphaForKind("tool"));
    expect(alphaForKind("system")).toBeLessThanOrEqual(alphaForKind("tool"));
  });
});

describe("minimapScale", () => {
  it("is strip height divided by total size", () => {
    expect(minimapScale(1000, 100)).toBeCloseTo(0.1);
  });

  it("is zero when total size is zero, without dividing by zero", () => {
    expect(minimapScale(0, 100)).toBe(0);
    expect(Number.isFinite(minimapScale(0, 100))).toBe(true);
  });
});

describe("viewportBox", () => {
  it("scales scrollTop and clientHeight by the given scale", () => {
    const box = viewportBox(200, 400, 0.1);
    expect(box.top).toBeCloseTo(20);
    expect(box.height).toBeCloseTo(40);
  });

  it("enforces a 6px minimum height for a tiny viewport", () => {
    const box = viewportBox(0, 10, 0.1);
    expect(box.height).toBe(6);
  });
});

describe("scrollTopForStripY and stripYForScrollTop (inverse mapping)", () => {
  it("round-trips for an interior y value", () => {
    const scale = 0.1;
    const clientHeight = 400;
    const scrollHeight = 10_000;
    const y = 500;
    const scrollTop = scrollTopForStripY(y, scale, clientHeight, scrollHeight);
    const roundTripped = stripYForScrollTop(scrollTop, scale, clientHeight);
    expect(roundTripped).toBeCloseTo(y, 0);
  });

  it("clamps scrollTop to 0 at the top end", () => {
    const scrollTop = scrollTopForStripY(0, 0.1, 400, 10_000);
    expect(scrollTop).toBe(0);
  });

  it("clamps scrollTop to scrollHeight - clientHeight at the bottom end", () => {
    const scrollTop = scrollTopForStripY(100_000, 0.1, 400, 10_000);
    expect(scrollTop).toBe(10_000 - 400);
  });

  it("clamps the range to [0, 0] when content is shorter than the viewport", () => {
    const scrollTop = scrollTopForStripY(500, 0.1, 400, 300);
    expect(scrollTop).toBe(0);
  });

  it("does not divide by zero when scale is zero", () => {
    expect(scrollTopForStripY(100, 0, 400, 10_000)).toBe(0);
  });
});

describe("viewportBox with a band above the map (PR 2)", () => {
  it("shifts the box down by the map's top", () => {
    const box = viewportBox(200, 400, 0.1, 30);
    expect(box.top).toBeCloseTo(50);
    expect(box.height).toBeCloseTo(40);
  });
});

describe("minimapBandHeight (PR 2, decision P2-1)", () => {
  it("is zero when every page is loaded", () => {
    expect(minimapBandHeight({ stripHeight: 400, hasMore: false, unloadedCount: 0, totalCount: 200 })).toBe(0);
  });

  it("is the unloaded share of the strip between the floor and the cap", () => {
    // 100 of 500 unloaded on a 400px strip: 80px, inside [24, 100].
    expect(minimapBandHeight({ stripHeight: 400, hasMore: true, unloadedCount: 100, totalCount: 500 })).toBe(80);
  });

  it("never drops below the 24px floor while older pages exist", () => {
    expect(minimapBandHeight({ stripHeight: 400, hasMore: true, unloadedCount: 1, totalCount: 10_000 })).toBe(
      MINIMAP_BAND_MIN_PX,
    );
  });

  it("never takes more than a quarter of the strip", () => {
    // 8,215 of 8,415 unloaded would be 98 percent of the strip.
    expect(minimapBandHeight({ stripHeight: 400, hasMore: true, unloadedCount: 8215, totalCount: 8415 })).toBe(
      400 * MINIMAP_BAND_MAX_SHARE,
    );
  });

  it("lets the cap win over the floor on a very short strip", () => {
    expect(minimapBandHeight({ stripHeight: 60, hasMore: true, unloadedCount: 900, totalCount: 1000 })).toBe(15);
  });

  it("falls back to the floor when the counts are unknown but older pages exist", () => {
    expect(minimapBandHeight({ stripHeight: 400, hasMore: true, unloadedCount: 0, totalCount: 0 })).toBe(
      MINIMAP_BAND_MIN_PX,
    );
  });
});

describe("minimapGeometry (PR 2)", () => {
  it("matches PR 1's numbers when there is no band", () => {
    const geometry = minimapGeometry({
      stripHeight: 200,
      contentHeight: 4000,
      hasMore: false,
      unloadedCount: 0,
      totalCount: 200,
    });
    expect(geometry).toEqual({ bandHeight: 0, mapTop: 0, mapHeight: 200, scale: minimapScale(4000, 200) });
  });

  it("maps the scroll content onto the region below the band", () => {
    const geometry = minimapGeometry({
      stripHeight: 400,
      contentHeight: 3200,
      hasMore: true,
      unloadedCount: 100,
      totalCount: 500,
    });
    expect(geometry.bandHeight).toBe(80);
    expect(geometry.mapTop).toBe(80);
    expect(geometry.mapHeight).toBe(320);
    expect(geometry.scale).toBeCloseTo(0.1);
  });
});

describe("rowIndexAtOffset (PR 2 hover, the prototype's rowAtOffset)", () => {
  const rows = [measurement(100, 50), measurement(150, 50), measurement(200, 50)];

  it("finds the row whose span holds the offset", () => {
    expect(rowIndexAtOffset(rows, 120)).toBe(0);
    expect(rowIndexAtOffset(rows, 199)).toBe(1);
    expect(rowIndexAtOffset(rows, 249)).toBe(2);
  });

  it("gives a shared boundary to the row that starts there", () => {
    expect(rowIndexAtOffset(rows, 150)).toBe(1);
  });

  it("returns -1 above the first row (the list header) and past the last row (the footer)", () => {
    expect(rowIndexAtOffset(rows, 99)).toBe(-1);
    expect(rowIndexAtOffset(rows, 250)).toBe(-1);
    expect(rowIndexAtOffset([], 0)).toBe(-1);
  });

  it("never returns a zero-height row (a collapsed agent task group member)", () => {
    // Leader at 0-100, two members measured at 0 height, then the next real row.
    const grouped = [measurement(0, 100), measurement(100, 0), measurement(100, 0), measurement(100, 40)];
    expect(rowIndexAtOffset(grouped, 50)).toBe(0);
    expect(rowIndexAtOffset(grouped, 100)).toBe(3);
    // Members at the very end: the pointer past the leader is past the list.
    const trailing = [measurement(0, 100), measurement(100, 0)];
    expect(rowIndexAtOffset(trailing, 100)).toBe(-1);
  });
});

describe("minimapTicks (PR 2 search ticks)", () => {
  const measurements = [measurement(0, 100), measurement(100, 100), measurement(200, 100), measurement(300, 100)];

  it("puts one tick at each matched row's start, in map coordinates", () => {
    const ticks = minimapTicks({
      rowIndices: [2, 0],
      currentRowIndex: -1,
      measurements,
      scale: 0.5,
      offset: 0,
      mapHeight: 200,
    });
    expect(ticks).toEqual([
      { y: 0, height: MINIMAP_TICK_HEIGHT_PX, current: false },
      { y: 100, height: MINIMAP_TICK_HEIGHT_PX, current: false },
    ]);
  });

  it("draws the current match last and taller, without a duplicate plain tick", () => {
    const ticks = minimapTicks({
      rowIndices: [1, 3],
      currentRowIndex: 1,
      measurements,
      scale: 0.5,
      offset: 0,
      mapHeight: 200,
    });
    expect(ticks).toHaveLength(2);
    expect(ticks[ticks.length - 1]).toEqual({ y: 50, height: MINIMAP_CURRENT_TICK_HEIGHT_PX, current: true });
  });

  it("merges ticks that land on the same pixel row", () => {
    const dense = Array.from({ length: 1000 }, (_, i) => measurement(i, 1));
    const ticks = minimapTicks({
      rowIndices: [10, 11, 12],
      currentRowIndex: -1,
      measurements: dense,
      scale: 0.01,
      offset: 0,
      mapHeight: 10,
    });
    expect(ticks).toHaveLength(1);
  });

  it("applies the list offset and keeps the tick inside the map at its bottom edge", () => {
    const ticks = minimapTicks({
      rowIndices: [3],
      currentRowIndex: 3,
      measurements,
      scale: 0.5,
      offset: 100,
      mapHeight: 200,
    });
    // (300 + 100) * 0.5 = 200, clamped so the 4px tick still fits.
    expect(ticks).toEqual([{ y: 196, height: MINIMAP_CURRENT_TICK_HEIGHT_PX, current: true }]);
  });

  it("skips a row index with no measurement", () => {
    const ticks = minimapTicks({
      rowIndices: [9],
      currentRowIndex: 9,
      measurements,
      scale: 0.5,
      offset: 0,
      mapHeight: 200,
    });
    expect(ticks).toEqual([]);
  });
});

describe("minimapTickX (PR 2)", () => {
  it("places the tick in the right gutter, clear of every bar", () => {
    const x = minimapTickX(64);
    expect(x + MINIMAP_TICK_WIDTH_PX).toBeLessThanOrEqual(64);
    expect(x).toBeGreaterThanOrEqual(64 - MINIMAP_TICK_GUTTER_PX);
    for (const kind of ALL_KINDS) {
      const bar = minimapBarRect(kind, 64);
      expect(bar.x + bar.width).toBeLessThanOrEqual(x);
    }
  });
});
