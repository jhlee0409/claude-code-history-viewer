import { describe, expect, it } from "vitest";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "../../../types";
import type { FlattenedMessage } from "../types";
import { findFirstVisibleMessageUuid } from "./visibleMessage";

function messageRow(uuid: string): FlattenedMessage {
  return {
    type: "message",
    message: { uuid } as unknown as ClaudeMessage,
  } as unknown as FlattenedMessage;
}

function dateDividerRow(): FlattenedMessage {
  return { type: "date-divider", timestamp: "2026-10-05T00:00:00.000Z" } as FlattenedMessage;
}

function hiddenRow(): FlattenedMessage {
  return { type: "hidden-placeholder", hiddenCount: 1, hiddenUuids: ["x"] } as FlattenedMessage;
}

function virtualItem(index: number, start: number, size: number): VirtualItem {
  return { index, start, size, key: index, lane: 0 } as unknown as VirtualItem;
}

describe("findFirstVisibleMessageUuid", () => {
  it("returns the uuid of the first row whose range extends past scrollTop", () => {
    const flattened = [messageRow("m1"), messageRow("m2"), messageRow("m3")];
    const rows = [virtualItem(0, 0, 50), virtualItem(1, 50, 50), virtualItem(2, 100, 50)];

    expect(findFirstVisibleMessageUuid(rows, flattened, 0)).toBe("m1");
    expect(findFirstVisibleMessageUuid(rows, flattened, 60)).toBe("m2");
    expect(findFirstVisibleMessageUuid(rows, flattened, 100)).toBe("m3");
  });

  it("skips a row that only peeks in at the top edge", () => {
    // Navigation aligns its target with the top edge; the row above it can
    // still end a fraction of a pixel below scrollTop. Measured in the WebUI:
    // the previous turn's last row ended at the edge and won the highlight.
    const flattened = [messageRow("previous"), messageRow("target")];
    const rows = [virtualItem(0, 0, 100.5), virtualItem(1, 100.5, 180)];

    expect(findFirstVisibleMessageUuid(rows, flattened, 100)).toBe("target");
    // 10 px of the previous row still showing is under the tolerance too.
    expect(findFirstVisibleMessageUuid(rows, flattened, 90.5)).toBe("target");
    // 30 px showing is a row the reader can see.
    expect(findFirstVisibleMessageUuid(rows, flattened, 70)).toBe("previous");
  });

  it("falls back to a peeking row when nothing else is in view", () => {
    const flattened = [messageRow("last")];
    const rows = [virtualItem(0, 0, 110)];

    expect(findFirstVisibleMessageUuid(rows, flattened, 100)).toBe("last");
  });

  it("returns null when scrollTop is past every row", () => {
    const flattened = [messageRow("m1")];
    const rows = [virtualItem(0, 0, 50)];

    expect(findFirstVisibleMessageUuid(rows, flattened, 100)).toBeNull();
  });

  it("returns null when there are no virtual rows", () => {
    expect(findFirstVisibleMessageUuid([], [], 0)).toBeNull();
  });

  it("skips a collapsed (size 0) row, such as a hidden group member", () => {
    const flattened = [messageRow("collapsed"), messageRow("m2")];
    // A hidden group member renders at height 0 (MessageViewer's
    // `measureElement` honors `aria-hidden`) and must never be reported as
    // the visible row even though its range technically starts at scrollTop.
    const rows = [virtualItem(0, 0, 0), virtualItem(1, 0, 50)];

    expect(findFirstVisibleMessageUuid(rows, flattened, 0)).toBe("m2");
  });

  it("skips a non-message row (date divider or hidden-blocks placeholder)", () => {
    const flattened = [dateDividerRow(), hiddenRow(), messageRow("m1")];
    const rows = [virtualItem(0, 0, 20), virtualItem(1, 20, 20), virtualItem(2, 40, 50)];

    expect(findFirstVisibleMessageUuid(rows, flattened, 0)).toBe("m1");
  });
});
