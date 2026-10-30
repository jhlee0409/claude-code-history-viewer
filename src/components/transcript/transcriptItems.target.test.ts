import { describe, expect, it } from "vitest";
import { buildTranscriptItems, itemIndexForTarget } from "./transcriptItems";
import { assistant, flattened, member, tool } from "./transcriptItems.fixtures";

const rows = flattened([tool("r1"), tool("r2")]);
const membership = member(["r1", 1], ["r2", 1]);
describe("single target lookup entry", () => {
  it("returns folded search target's exact block and every member to expand without mutating", () => {
    const model = buildTranscriptItems(rows, membership);
    expect(itemIndexForTarget(model, { messageUuid: "r2" })).toEqual({ itemIndex: 1, blockId: "r2#0", expandBlockIds: ["r1#0", "r1#1", "r2#0", "r2#1"] });
    expect(model.runByBlockId.get("r2#0")?.expanded).toBe(false);
    const revealed = buildTranscriptItems(rows, membership, { revealTargets: [{ messageUuid: "r2" }] });
    expect(revealed.runByBlockId.get("r2#0")?.expanded).toBe(true);
  });
  it("resolves contentIndex across fragments and defaults to the message's first block", () => {
    const content = Array.from({ length: 26 }, (_, n) => ({ type: "text" as const, text: String(n) }));
    const model = buildTranscriptItems(flattened([assistant("a", content)]), member(["a", 1]));
    expect(itemIndexForTarget(model, { messageUuid: "a", contentIndex: 25 })).toMatchObject({ itemIndex: 2, blockId: "a#25" });
    expect(itemIndexForTarget(model, { messageUuid: "a" })).toMatchObject({ itemIndex: 1, blockId: "a#0" });
    expect(model.messageToItemIndexes.get("a")).toEqual([1, 2]);
    expect(itemIndexForTarget(model, { messageUuid: "a", contentIndex: 99 })).toBeNull();
  });
  it("reveals saved anchor and focused block inside a run through the same lookup", () => {
    const model = buildTranscriptItems(rows, membership, { revealTargets: [{ blockId: "r2#1" }] });
    expect(model.runByBlockId.get("r2#1")?.expanded).toBe(true);
    expect(itemIndexForTarget(model, { blockId: "r2#1" })).toMatchObject({ itemIndex: 1, blockId: "r2#0", expandBlockIds: [] });
  });
  it("capture mode opens runs, while hidden placeholder UUIDs remain unavailable", () => {
    const model = buildTranscriptItems([...rows, { type: "hidden-placeholder", hiddenCount: 1, hiddenUuids: ["hidden"] }], membership, { captureMode: true });
    expect(model.runByBlockId.get("r1#0")?.expanded).toBe(true);
    expect(itemIndexForTarget(model, { messageUuid: "hidden" })).toBeNull();
    expect(itemIndexForTarget(model, { messageUuid: "missing" })).toBeNull();
  });
});
