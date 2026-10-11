import { describe, expect, it } from "vitest";
import type { OutlineRow } from "./flattenOutline";
import { includeIndex, resolveFocusAfterRowsChange } from "./rovingFocus";

const turn = (key: string): OutlineRow =>
  ({ type: "turn", key, turn: {} as never, isOpen: false, posInSet: 1, setSize: 1 }) as OutlineRow;
const child = (key: string, turnKey: string): OutlineRow =>
  ({ type: "child", key, turnKey, child: {} as never, posInSet: 1, setSize: 1 }) as OutlineRow;

describe("resolveFocusAfterRowsChange", () => {
  it("follows the focused row to its new index", () => {
    const before = [turn("t1"), turn("t2")];
    const after = [turn("t1"), child("c1", "t1"), turn("t2")];
    expect(resolveFocusAfterRowsChange(before, after, 1)).toBe(2);
  });

  it("falls back to the parent header when the focused child disappears", () => {
    const before = [turn("t1"), child("c1", "t1"), child("c2", "t1"), turn("t2")];
    const after = [turn("t1"), turn("t2")];
    expect(resolveFocusAfterRowsChange(before, after, 2)).toBe(0);
  });

  it("clamps when neither the row nor its parent survives", () => {
    const before = [turn("t1"), turn("t2"), turn("t3")];
    const after = [turn("x1")];
    expect(resolveFocusAfterRowsChange(before, after, 2)).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(resolveFocusAfterRowsChange([turn("t1")], [], 0)).toBe(0);
  });
});

describe("includeIndex", () => {
  it("adds an index outside the rendered range, keeping order", () => {
    expect(includeIndex([3, 4, 5], 10, 20)).toEqual([3, 4, 5, 10]);
    expect(includeIndex([3, 4, 5], 0, 20)).toEqual([0, 3, 4, 5]);
  });

  it("leaves the range alone when the index is already in it or out of bounds", () => {
    expect(includeIndex([3, 4, 5], 4, 20)).toEqual([3, 4, 5]);
    expect(includeIndex([3, 4, 5], 25, 20)).toEqual([3, 4, 5]);
    expect(includeIndex([3, 4, 5], -1, 20)).toEqual([3, 4, 5]);
  });
});
