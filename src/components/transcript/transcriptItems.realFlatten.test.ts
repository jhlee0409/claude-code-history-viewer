import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { flattenMessageTree } from "../MessageViewer/helpers/flattenMessageTree";
import { groupAgentProgressMessages } from "../MessageViewer/helpers/agentProgressHelpers";
import { buildTranscriptItems, itemIndexForTarget } from "./transcriptItems";
import { assistant, flattened, member, tool, user } from "./transcriptItems.fixtures";

const command = () => user("cmd", "<command-name>/cost</command-name>");
const output = (uuid = "out", text = "cost: 1"): ClaudeMessage => ({
  ...user(uuid, `<local-command-stdout>${text}</local-command-stdout>`), parentUuid: "cmd",
});
const progress = (uuid: string): ClaudeMessage => ({
  ...user(uuid), type: "progress", data: { type: "agent_progress", agentId: "agent" },
});
const grouped = (messages: ClaudeMessage[], subject = "task") => flattenMessageTree({
  messages,
  agentTaskGroups: new Map([["task", { tasks: [], messageUuids: new Set(["task", "task-member"]) }]]),
  agentTaskMemberUuids: new Set(["task-member"]),
  agentProgressGroups: groupAgentProgressMessages(messages),
  agentProgressMemberUuids: new Set(["p2", "p3"]),
  taskOperationGroups: new Map([["op", { operations: [], taskRegistry: new Map([["id", { id: "id", subject, status: "pending" as const }]]), messageUuids: new Set(["op"]) }]]),
  taskOperationMemberUuids: new Set(),
});

// Real flattening recreates merged command messages, progress wrappers and entries.
describe("incremental identity through the real flattener", () => {
  it.each(["append", "prepend"] as const)("%s preserves unchanged command/group turns across date dividers", direction => {
    const messages = [command(), output(), user("task"), user("task-member"), progress("p1"), progress("p2"), user("op"),
      { ...user("next"), timestamp: "2026-01-03T12:00:00Z" }];
    const membership = member(["cmd", 1], ["task", 2], ["task-member", 2], ["p1", 2], ["p2", 2], ["op", 2], ["next", 3], ["extra", 4]);
    const before = buildTranscriptItems(grouped(messages), membership);
    const extra = { ...user("extra"), timestamp: direction === "append" ? "2026-01-04T12:00:00Z" : "2025-12-30T12:00:00Z" };
    const after = buildTranscriptItems(grouped(direction === "append" ? [...messages, extra] : [extra, ...messages]), membership, { previous: before });
    expect(before.items.filter(i => i.kind === "date-divider")).toHaveLength(2);
    expect(after.items.filter(i => i.kind === "date-divider")).toHaveLength(3);
    expect(before.blocks.get("task#0")?.kind).toBe("checklist");
    expect(before.blocks.get("p1#0")?.source.agentProgressGroup?.entries).toHaveLength(2);
    for (const turn of before.turns) {
      expect(after.turns.find(t => t.id === turn.id)).toBe(turn);
      for (const block of turn.blocks) expect(after.blocks.get(block.id)).toBe(block);
    }
    expect(itemIndexForTarget(after, { blockId: "cmd#0" })?.itemIndex).toBe(
      itemIndexForTarget(before, { blockId: "cmd#0" })!.itemIndex + (direction === "prepend" ? 2 : 0),
    );
  });

  it("new merged stdout replaces the block and turn without changing the old snapshot", () => {
    const messages = [command(), output()];
    const membership = member(["cmd", 1]);
    const before = buildTranscriptItems(flattened(messages), membership);
    const after = buildTranscriptItems(flattened([...messages, output("out2", "cost: 2")]), membership, { previous: before });
    expect(after.turns[0]).not.toBe(before.turns[0]);
    expect(after.blocks.get("cmd#0")).not.toBe(before.blocks.get("cmd#0"));
    expect(after.blocks.get("cmd#0")?.value).toContain("cost: 2");
    expect(before.blocks.get("cmd#0")?.value).not.toContain("cost: 2");
  });

  it("changed outcome replaces cached content and recomputes the summary", () => {
    const membership = member(["r", 1]);
    const before = buildTranscriptItems(flattened([tool("r")]), membership);
    const after = buildTranscriptItems(flattened([tool("r", "Read", { content: "failed", is_error: true })]), membership, { previous: before });
    expect(after.turns[0]).not.toBe(before.turns[0]);
    expect(after.blocks.get("r#0")).not.toBe(before.blocks.get("r#0"));
    expect(after.turns[0]?.summary.failed).toBe(1);
    expect(before.turns[0]?.summary.failed).toBe(0);
  });

  it("changed progress entries replace the leader snapshot", () => {
    const messages = [progress("p1"), progress("p2")];
    const membership = member(["p1", 1], ["p2", 1], ["p3", 1]);
    const before = buildTranscriptItems(grouped(messages), membership);
    const after = buildTranscriptItems(grouped([...messages, progress("p3")]), membership, { previous: before });
    expect(after.turns[0]).not.toBe(before.turns[0]);
    expect(after.blocks.get("p1#0")).not.toBe(before.blocks.get("p1#0"));
    expect(after.blocks.get("p1#0")?.source.agentProgressGroup?.entries).toHaveLength(3);
    expect(before.blocks.get("p1#0")?.source.agentProgressGroup?.entries).toHaveLength(2);
  });

  it("changed task registry Maps invalidate the renderer snapshot", () => {
    const messages = [user("op")];
    const membership = member(["op", 1]);
    const before = buildTranscriptItems(grouped(messages), membership);
    const after = buildTranscriptItems(grouped(messages, "updated task"), membership, { previous: before });
    expect(after.turns[0]).not.toBe(before.turns[0]);
    expect(after.blocks.get("op#0")).not.toBe(before.blocks.get("op#0"));
    expect(after.blocks.get("op#0")?.source.taskRegistry?.get("id")?.subject).toBe("updated task");
    expect(before.blocks.get("op#0")?.source.taskRegistry?.get("id")?.subject).toBe("task");
  });

  it("equivalent records ignore key insertion order but removed metadata invalidates", () => {
    const original = { ...user("u"), model: "recorded" };
    const membership = member(["u", 1]);
    const before = buildTranscriptItems(flattened([original]), membership);
    const reordered = Object.fromEntries(Object.entries(original).reverse()) as unknown as ClaudeMessage;
    const same = buildTranscriptItems(flattened([reordered]), membership, { previous: before });
    expect(same.turns[0]).toBe(before.turns[0]);
    const removed = buildTranscriptItems(flattened([user("u")]), membership, { previous: same });
    expect(removed.blocks.get("u#0")).not.toBe(same.blocks.get("u#0"));
    expect(removed.blocks.get("u#0")?.source.message).not.toHaveProperty("model");
  });

  it("membership arrival rebuilds the turn but retains unchanged source blocks", () => {
    const messages = [assistant("a")];
    const before = buildTranscriptItems(flattened(messages), new Map());
    const after = buildTranscriptItems(flattened(messages), member(["a", 2]), { previous: before, turnStartUuids: new Map([[2, "root"]]) });
    expect(after.turns[0]).not.toBe(before.turns[0]);
    expect(after.turns[0]).toMatchObject({ id: "turn:root", ordinal: 2, partial: true });
    expect(after.blocks.get("a#0")).toBe(before.blocks.get("a#0"));
    expect(before.turns[0]?.ordinal).toBeNull();
  });
});
