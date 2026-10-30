import { describe, expect, it } from "vitest";
import { buildTranscriptItems, itemIndexForTarget, type TurnChunk } from "./transcriptItems";
import { assistant, flattened, member, tool, user } from "./transcriptItems.fixtures";

describe("incremental transcript identity", () => {
  it("append rebuilds the last turn only and preserves earlier turn objects ===", () => {
    const messages = [user("u1"), assistant("a1"), user("u2"), assistant("a2")];
    const membership = member(["u1", 1], ["a1", 1], ["u2", 2], ["a2", 2], ["a3", 2]);
    const before = buildTranscriptItems(flattened(messages), membership);
    const after = buildTranscriptItems(flattened([...messages, assistant("a3")]), membership, { previous: before });
    expect(after.turns[0]).toBe(before.turns[0]);
    expect(after.turns[1]).not.toBe(before.turns[1]);
    expect(after.turns[0]?.blocks[0]).toBe(before.turns[0]?.blocks[0]);
    expect(before.turns[1]?.blocks.map(b => b.id)).toEqual(["u2#0", "a2#0"]);
  });
  it("prepend remaps the saved block anchor without changing its offset or unrelated turns", () => {
    const messages = [user("u2"), assistant("a2")];
    const membership = member(["u1", 1], ["a1", 1], ["u2", 2], ["a2", 2]);
    const before = buildTranscriptItems(flattened(messages), membership);
    const anchor = { blockId: "a2#0", offset: 37 };
    const after = buildTranscriptItems(flattened([user("u1"), assistant("a1"), ...messages]), membership, { previous: before });
    expect(itemIndexForTarget(after, anchor)?.itemIndex).toBe((itemIndexForTarget(before, anchor)?.itemIndex ?? -1) + 1);
    expect(anchor.offset).toBe(37);
    expect(after.turns[1]).toBe(before.turns[0]);
    expect(after.items.filter((i): i is TurnChunk => i.kind === "turn").map(i => i.posinset)).toEqual([1, 2]);
  });
  it("split runs retain expansion through all block IDs, not only the old first one", () => {
    const messages = [tool("r1"), tool("r2"), tool("r3"), tool("r4")];
    const membership = new Map([...messages.map(m => [m.uuid, 1] as const), ["break", 1] as const]);
    const before = buildTranscriptItems(flattened(messages), membership, { revealTargets: [{ messageUuid: "r3" }] });
    const after = buildTranscriptItems(flattened([...messages.slice(0, 2), assistant("break", "boundary"), ...messages.slice(2)]), membership, { previous: before });
    const runs = [...new Set(after.runByBlockId.values())];
    expect(runs.map(r => [r.id, r.expanded])).toEqual([["run:r1#0", true], ["run:r3#0", true]]);
    expect(before.runByBlockId.get("r1#0")?.blocks).toHaveLength(4);
  });
  it("capture expansion is temporary when the next model only receives previous", () => {
    const messages = [tool("r1"), tool("r2")];
    const membership = member(["r1", 1], ["r2", 1]);
    const before = buildTranscriptItems(flattened(messages), membership);
    const capture = buildTranscriptItems(flattened(messages), membership, { previous: before, captureMode: true });
    const after = buildTranscriptItems(flattened(messages), membership, { previous: capture });
    expect(capture.runByBlockId.get("r1#0")?.expanded).toBe(true);
    expect(capture.expandedBlockIds.size).toBe(0);
    expect(after.runByBlockId.get("r1#0")?.expanded).toBe(false);
    expect(before.runByBlockId.get("r1#0")?.expanded).toBe(false);
  });
  it.each(["explicit", "reveal"] as const)("capture preserves %s expansion including aliases without persisting unrelated runs", mode => {
    const messages = [tool("r1"), tool("r2"), assistant("break"), tool("r3"), tool("r4")];
    const membership = new Map(messages.map(m => [m.uuid, 1] as const));
    const capture = buildTranscriptItems(flattened(messages), membership, {
      captureMode: true,
      ...(mode === "explicit" ? { expandedBlockIds: new Set(["r2#1"]) } : { revealTargets: [{ blockId: "r2#1" }] }),
    });
    expect([...new Set(capture.runByBlockId.values())].every(run => run.expanded)).toBe(true);
    expect(capture.expandedBlockIds.has("r2#1")).toBe(true);
    expect(capture.expandedBlockIds.has("r3#0")).toBe(false);
    const after = buildTranscriptItems(flattened(messages), membership, { previous: capture });
    expect(after.runByBlockId.get("r1#0")?.expanded).toBe(true);
    expect(after.runByBlockId.get("r3#0")?.expanded).toBe(false);
    expect([...after.expandedBlockIds].sort()).toEqual(["r1#0", "r1#1", "r2#0", "r2#1"]);
  });
  it("explicit empty expansion closes previous runs and does not mutate prior models", () => {
    const messages = [tool("r1"), tool("r2")];
    const membership = member(["r1", 1], ["r2", 1]);
    const before = buildTranscriptItems(flattened(messages), membership, { captureMode: true });
    const after = buildTranscriptItems(flattened(messages), membership, { previous: before, expandedBlockIds: new Set() });
    expect(after.runByBlockId.get("r1#0")?.expanded).toBe(false);
    expect(before.runByBlockId.get("r1#0")?.expanded).toBe(true);
  });
});
