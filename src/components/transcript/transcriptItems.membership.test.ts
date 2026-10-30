import { describe, expect, it } from "vitest";
import { buildTranscriptItems } from "./transcriptItems";
import { assistant, flattened, member, user } from "./transcriptItems.fixtures";

describe("transcript membership is supplied, never inherited", () => {
  const rows = flattened([user("u2"), assistant("a1"), assistant("a2")]);
  it("keeps a1 in turn 1 inside the partial chronological window [u2,a1,a2]", () => {
    const model = buildTranscriptItems(rows, member(["a1", 1], ["u2", 2], ["a2", 2]), { turnStartUuids: new Map([[1, "u1"], [2, "u2"]]) });
    expect(model.turns.map(t => [t.ordinal, t.partial, t.blocks.map(b => b.id)])).toEqual([
      [2, false, ["u2#0"]], [1, true, ["a1#0"]], [2, true, ["a2#0"]],
    ]);
    expect(model.turns.map(t => t.id)).toEqual(["turn:u2", "turn:u1", "turn:u2"]);
  });
  it("gives unknown messages no ordinal, even immediately after a known turn", () => {
    const model = buildTranscriptItems(rows, member(["u2", 2]));
    expect(model.turns.map(t => t.ordinal)).toEqual([2, null]);
    expect(model.turns[1]?.blocks.map(b => b.id)).toEqual(["a1#0", "a2#0"]);
  });
  it("regroups unknown membership on arrival without replacing source block IDs", () => {
    const before = buildTranscriptItems(rows, new Map());
    const after = buildTranscriptItems(rows, member(["a1", 1], ["u2", 2], ["a2", 2]), { previous: before });
    expect(before.turns.map(t => t.ordinal)).toEqual([null]);
    expect(after.turns.map(t => t.ordinal)).toEqual([2, 1, 2]);
    expect(after.turns.flatMap(t => t.blocks.map(b => b.id))).toEqual(before.turns.flatMap(t => t.blocks.map(b => b.id)));
  });
  it("makes an assistant-first page partial without inventing a turn number", () => {
    const model = buildTranscriptItems(flattened([assistant("a")]), new Map());
    expect(model.turns[0]).toMatchObject({ ordinal: null, partial: true });
  });
});
