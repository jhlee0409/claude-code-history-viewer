import { describe, expect, it } from "vitest";
import {
  bucketMinimapRows,
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
