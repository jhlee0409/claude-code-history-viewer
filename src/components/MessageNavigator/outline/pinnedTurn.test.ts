import { describe, expect, it } from "vitest";
import { findFirstVisibleIndex, findPinnedTurnKey } from "./pinnedTurn";
import type { OutlineRow } from "./flattenOutline";

function item(index: number, start: number, size: number) {
  return { index, start, size };
}

describe("findFirstVisibleIndex", () => {
  it("returns the index of the first item whose end extends past scrollTop", () => {
    const items = [item(0, 0, 40), item(1, 40, 40), item(2, 80, 40)];
    expect(findFirstVisibleIndex(items, 50)).toBe(1);
  });

  it("returns the item's own index field, not its array position", () => {
    // Simulates overscan: the rendered items array can start mid-list.
    const items = [item(5, 200, 40), item(6, 240, 40)];
    expect(findFirstVisibleIndex(items, 210)).toBe(5);
  });

  it("returns null when nothing is visible", () => {
    const items = [item(0, 0, 40)];
    expect(findFirstVisibleIndex(items, 1000)).toBeNull();
  });

  it("returns null for an empty item list", () => {
    expect(findFirstVisibleIndex([], 0)).toBeNull();
  });

  it("treats scrollTop 0 as the first row visible", () => {
    const items = [item(0, 0, 40), item(1, 40, 40)];
    expect(findFirstVisibleIndex(items, 0)).toBe(0);
  });
});

describe("findPinnedTurnKey", () => {
  const turnRow: OutlineRow = {
    type: "turn",
    key: "p1",
    turn: {
      key: "p1",
      turnStartUuid: "p1",
      turnNumber: 1,
      header: null,
      firstUuid: "p1",
      counts: { replies: 0, toolCalls: 0, agentsStarted: 0, agentUpdates: 0 },
      children: [],
      uuids: ["p1", "r1"],
    },
    isOpen: true,
    posInSet: 1,
    setSize: 1,
  };
  const childRow: OutlineRow = {
    type: "child",
    key: "r1",
    turnKey: "p1",
    child: { type: "message", key: "r1", entry: {
      uuid: "r1", role: "assistant", kind: "reply", preview: "", timestamp: "", hasToolUse: false, turnIndex: 2,
    } },
    posInSet: 1,
    setSize: 1,
  };
  const rows: OutlineRow[] = [turnRow, childRow];

  it("returns the turnKey of the first visible row's turn when it is a child row", () => {
    const items = [item(0, 0, 40), item(1, 40, 40)];
    expect(findPinnedTurnKey(rows, items, 50)).toBe("p1");
  });

  it("returns null when the first visible row is a turn header", () => {
    const items = [item(0, 0, 40), item(1, 40, 40)];
    expect(findPinnedTurnKey(rows, items, 0)).toBeNull();
  });

  it("returns null when nothing is visible", () => {
    const items = [item(0, 0, 40)];
    expect(findPinnedTurnKey(rows, items, 1000)).toBeNull();
  });

  it("returns null when the visible index has no matching row", () => {
    const items = [item(5, 0, 40)];
    expect(findPinnedTurnKey(rows, items, 0)).toBeNull();
  });
});
