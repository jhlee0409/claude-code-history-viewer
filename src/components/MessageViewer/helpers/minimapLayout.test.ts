import { describe, expect, it } from "vitest";
import {
  alphaForKind,
  bucketMinimapRows,
  minimapBarRect,
  MINIMAP_BAR_PAD_PX,
  MINIMAP_TICK_GUTTER_PX,
  minimapScale,
  priorityForKind,
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
