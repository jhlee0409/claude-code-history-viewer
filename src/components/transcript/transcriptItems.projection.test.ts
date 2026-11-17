import { describe, expect, it } from "vitest";
import { buildTranscriptItems, itemIndexForTarget, type TurnChunk } from "./transcriptItems";
import { assistant, flattened, tool, user } from "./transcriptItems.fixtures";
import type { FlattenedMessageItem } from "../MessageViewer/types";

const chunks = (model: ReturnType<typeof buildTranscriptItems>) => model.items.filter((item): item is TurnChunk => item.kind === "turn");
const rows = (messages: Parameters<typeof flattened>[0]) => flattened(messages).filter((row): row is FlattenedMessageItem => row.type === "message");
const build = (input: ReturnType<typeof rows>, options = {}) => buildTranscriptItems(input, new Map(input.map(row => [row.message.uuid, 1])), { complete: true, ...options });

describe("visible projection before folding and chunking", () => {
  it.each([25, 49, 1000])("folds %i consecutive eligible calls once before entry/height limits", count => {
    const input = rows([user("u"), ...Array.from({ length: count }, (_, i) => tool(`r${i}`)), assistant("end")]);
    const model = build(input, { viewportHeight: 100, estimateBlockHeight: () => 20 });
    const runs = chunks(model).flatMap(chunk => chunk.entries.filter(entry => entry.kind === "toolRun"));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.blocks).toHaveLength(count);
    expect(chunks(model).flatMap(chunk => chunk.entries)).toHaveLength(3);
    expect(model.turns[0]?.summary.tools).toBe(count);
    expect(itemIndexForTarget(model, { messageUuid: `r${count - 1}`, contentIndex: 1 })?.expandBlockIds).toHaveLength(count * 2);
    const opened = build(input, { viewportHeight: 100, estimateBlockHeight: () => 20, revealTargets: [{ messageUuid: `r${count - 1}` }] });
    expect(chunks(opened).every(chunk => chunk.blocks.length <= 15)).toBe(true);
    expect(new Set(opened.runByBlockId.values()).size).toBe(1);
    expect(opened.expandedBlockIds.size).toBe(count * 2);
  });

  it.each(["sidechain", "empty", "task", "progress", "operation"])("excludes hidden %s from counts, run breaks, height and coordinates", hidden => {
    const input = rows([tool("a"), tool("hidden"), tool("b")]);
    const middle = input[1]!;
    if (hidden === "sidechain") middle.message.isSidechain = true;
    if (hidden === "empty") middle.message = assistant("hidden", []);
    if (hidden === "task") middle.isGroupMember = true;
    if (hidden === "progress") middle.isProgressGroupMember = true;
    if (hidden === "operation") middle.isTaskOperationGroupMember = true;
    const model = build(input);
    expect(model.turns[0]?.blocks.map(block => block.messageUuid)).toEqual(["a", "b"]);
    expect(model.turns[0]?.summary).toEqual({ tools: 2, files: 2, failed: 0, unverified: 0 });
    expect(chunks(model).map(chunk => [chunk.entries.length, chunk.posinset, chunk.setsize])).toEqual([[1, 1, 1]]);
    if (hidden === "sidechain") expect(build(input, { inSubagent: true }).turns[0]?.summary.tools).toBe(3);
  });

  it.each(["task", "progress", "operation"])("aliases a hidden %s member to its real visible leader", family => {
    const input = rows([assistant("leader"), assistant("member")]);
    const leader = input[0]!; const member = input[1]!;
    Reflect.set(member, "groupLeaderUuid", "leader");
    if (family === "task") { leader.isGroupLeader = true; leader.agentTaskGroup = [{ messageUuid: "member" }] as unknown as NonNullable<typeof leader.agentTaskGroup>; member.isGroupMember = true; }
    if (family === "progress") { leader.isProgressGroupLeader = true; leader.agentProgressGroup = { agentId: "agent", entries: [{ uuid: "member" }] as unknown as NonNullable<typeof leader.agentProgressGroup>["entries"] }; member.isProgressGroupMember = true; }
    if (family === "operation") { leader.isTaskOperationGroupLeader = true; leader.taskOperationGroup = [{ messageUuid: "member" }] as unknown as NonNullable<typeof leader.taskOperationGroup>; member.isTaskOperationGroupMember = true; }
    const model = build(input);
    expect(model.turns[0]?.blocks).toHaveLength(1);
    expect(itemIndexForTarget(model, { messageUuid: "member" })?.blockId).toBe("leader#0");
    expect(model.messageToItemIndexes.get("member")).toEqual(model.messageToItemIndexes.get("leader"));
  });
  it("uses recorded grouping membership, never the nearest same-family leader", () => {
    const input = rows([assistant("first"), assistant("second"), assistant("member")]);
    input[0]!.isGroupLeader = true;
    input[1]!.isGroupLeader = true;
    input[2]!.isGroupMember = true;
    Reflect.set(input[2]!, "groupLeaderUuid", "first");
    expect(itemIndexForTarget(build(input), { messageUuid: "member" })?.blockId).toBe("first#0");
  });
});
