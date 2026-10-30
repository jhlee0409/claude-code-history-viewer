import { describe, expect, it } from "vitest";
import { buildTranscriptItems, type TurnChunk } from "./transcriptItems";
import { assistant, flattened, member, tool, user } from "./transcriptItems.fixtures";
import type { ClaudeMessage, ContentItem } from "@/types";

const build = (messages: ClaudeMessage[]) => buildTranscriptItems(flattened(messages), new Map(messages.map(m => [m.uuid, 1])));
const chunks = (model: ReturnType<typeof build>) => model.items.filter((i): i is TurnChunk => i.kind === "turn");
const runs = (model: ReturnType<typeof build>) => chunks(model).flatMap(c => c.entries.filter(e => e.kind === "toolRun"));
describe("transcript items and D-R2 folding", () => {
  it("folds two verified read/search calls as one run, retaining result block aliases", () => {
    const model = build([user("u"), tool("r1"), tool("r2", "Grep")]);
    expect(runs(model)).toMatchObject([{ id: "run:r1#0", expanded: false, blocks: [{ id: "r1#0" }, { id: "r2#0" }] }]);
    expect(model.blockToItemIndex.get("r1#1")).toBe(model.blockToItemIndex.get("r1#0"));
  });
  it.each([
    ["failed read", tool("middle", "Read", { content: "error: denied", is_error: true })],
    ["E15 Bash unknown", tool("middle", "Bash", { content: "", toolUseResult: { stdout: "", stderr: "fatal", interrupted: false } })],
    ["edit", tool("middle", "Edit")],
    ["interrupted", tool("middle", "Read", { content: "ok", toolUseResult: { interrupted: true } })],
    ["no-result", tool("middle", "Read", null)],
    ["unknown tool", tool("middle", "mcp__custom")],
    ["prose", assistant("middle", "not a call")],
  ])("%s breaks a run and stays in place", (_name, middle) => {
    const model = build([tool("r1"), middle, tool("r2")]);
    expect(runs(model)).toHaveLength(0);
    expect(model.turns[0]?.blocks.map(b => b.messageUuid)).toEqual(["r1", "middle", "r2"]);
  });
  it("leaves one Read unfolded and never folds across turns", () => {
    expect(runs(build([tool("r")]))).toHaveLength(0);
    const model = buildTranscriptItems(flattened([tool("r1"), tool("r2")]), member(["r1", 1], ["r2", 2]));
    expect(runs(model)).toHaveLength(0);
  });
  it("counts calls, unique files, failures and unverified outcomes, not result aliases", () => {
    const model = build([tool("read"), tool("bad", "Read", { is_error: true, content: "denied" }), tool("unknown", "Bash"), tool("none", "Read", null), tool("stop", "Read", { content: "ok", toolUseResult: { interrupted: true } })]);
    expect(model.turns[0]?.summary).toEqual({ tools: 5, files: 5, failed: 1, unverified: 3 });
  });
  it("does not recreate groups, date dividers or capture hidden placeholders", () => {
    const rows = flattened([user("u"), assistant("a")]);
    const hidden = { type: "hidden-placeholder" as const, hiddenCount: 1, hiddenUuids: ["hidden"] };
    rows.push(hidden);
    const model = buildTranscriptItems(rows, new Map());
    expect(model.items[0]).toMatchObject({ kind: "date-divider", source: rows[0] });
    expect(model.items.at(-1)).toMatchObject({ kind: "hidden", source: hidden });
    expect(model.items[0]?.kind !== "turn" && model.items[0]?.source).toBe(rows[0]);
  });
  it("retains media, unknown blocks and checklist source metadata for existing renderers", () => {
    const model = build([assistant("a", [{ type: "image", source: { type: "url", url: "x" } }, { type: "future", payload: "keep" }] as unknown as ContentItem[])]);
    expect(model.turns[0]?.blocks.map(b => b.kind)).toEqual(["fallback", "fallback"]);
    expect(model.turns[0]?.blocks[1]?.value).toEqual({ type: "future", payload: "keep" });
  });
  it("does not let hidden/filtered tools contribute to a new run or summary", () => {
    const model = build([user("u"), assistant("a", "visible prose")]);
    expect(model.turns[0]?.summary.tools).toBe(0);
    expect(runs(model)).toHaveLength(0);
  });
  it("handles empty content and legacy call envelopes without dropping their source", () => {
    const empty = build([assistant("empty", [])]);
    expect(empty.turns[0]?.blocks).toMatchObject([{ id: "empty#0", kind: "fallback", value: [] }]);
    const legacy = { ...assistant("legacy"), content: undefined, toolUse: { name: "Read", id: "t", input: { file_path: "/x" } } };
    const model = build([legacy]);
    expect(model.turns[0]?.blocks[0]).toMatchObject({ kind: "toolRow", outcome: { lifecycle: "no-result" }, foldable: false });
    expect(model.turns[0]?.summary.tools).toBe(1);
  });
  it("judges a legacy top-level call's result through the same outcome adapter", () => {
    const legacy = { ...assistant("legacy"), content: undefined, toolUse: { name: "Read", id: "t", input: { file_path: "/x" } }, toolUseResult: "file contents" };
    const model = build([legacy]);
    expect(model.turns[0]?.blocks[0]).toMatchObject({ kind: "toolRow", outcome: { lifecycle: "completed", verdict: "succeeded" } });
    const failed = build([{ ...legacy, toolUseResult: { is_error: true, content: "denied" } }]);
    expect(failed.turns[0]?.summary).toMatchObject({ tools: 1, failed: 1, unverified: 0 });
  });
  it("preserves a source-owned grouped row and does not fold its hidden members", () => {
    const rows = flattened([tool("r1"), tool("r2")]);
    const first = rows[1]; const second = rows[2];
    if (first?.type !== "message" || second?.type !== "message") throw new Error("fixture");
    first.isGroupLeader = true; first.agentTaskGroup = [];
    second.isGroupMember = true;
    const model = buildTranscriptItems(rows, member(["r1", 1], ["r2", 1]));
    expect(model.turns[0]?.blocks.map(b => b.kind)).toEqual(["checklist", "checklist"]);
    expect(model.runByBlockId.size).toBe(0);
    expect(model.turns[0]?.blocks[1]?.source.isGroupMember).toBe(true);
  });
  it("does not replace authoritative start UUIDs from the index with a loaded row", () => {
    const model = buildTranscriptItems(flattened([user("alias")]), member(["alias", 1]), { turnStartUuids: new Map([[1, "canonical"]]) });
    expect(model.turns[0]?.id).toBe("turn:canonical");
    expect(model.turns[0]?.partial).toBe(true);
  });
  it("uses sidechain context only for temporary grouping, never to invent membership", () => {
    const messages = [user("u1"), { ...user("u2"), isSidechain: true }];
    expect(buildTranscriptItems(flattened(messages), new Map()).turns).toHaveLength(1);
    expect(buildTranscriptItems(flattened(messages), new Map(), { inSubagent: true }).turns).toHaveLength(2);
  });
});

describe("bounded turn fragments (data only)", () => {
  const message = assistant("big", Array.from({ length: 25 }, (_, n) => ({ type: "text", text: String(n) })));
  it("splits 25 blocks into two unique chunks with distinct feed coordinates", () => {
    const model = buildTranscriptItems(flattened([message]), member(["big", 212]), { complete: true });
    const parts = chunks(model);
    expect(parts.map(c => c.blocks.length)).toEqual([24, 1]);
    expect(parts.map(c => [c.part, c.parts, c.posinset, c.setsize])).toEqual([[1, 2, 1, 2], [2, 2, 2, 2]]);
    expect(parts.map(c => c.id)).toEqual(["turn:big:big#0", "turn:big:big#24"]);
    expect(parts[0]?.turnStart?.kind).toBe("turnStart");
    expect(parts[1]?.turnStart).toBeNull();
  });
  it("uses -1 setsize on partial feeds and height boundaries without splitting blocks", () => {
    const model = buildTranscriptItems(flattened([message]), member(["big", 212]), { viewportHeight: 100, estimateBlockHeight: () => 200 });
    expect(chunks(model)).toHaveLength(25);
    expect(chunks(model).every(c => c.setsize === -1)).toBe(true);
    expect(model.messageToItemIndexes.get("big")).toHaveLength(25);
  });
});
