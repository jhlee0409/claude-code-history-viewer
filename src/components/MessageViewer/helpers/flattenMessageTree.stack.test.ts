import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { buildUuidToIndexMap, flattenMessageTree } from "./flattenMessageTree";
import { groupAgentProgressMessages } from "./agentProgressHelpers";

const message = (uuid: string, second: number, parentUuid?: string): ClaudeMessage => ({
  uuid, parentUuid, sessionId: "stack", type: "assistant", role: "assistant",
  timestamp: new Date(Date.UTC(2026, 0, 1, 12, 0, second)).toISOString(),
  content: `message ${uuid}`, model: "test-model",
});
const options = (messages: ClaudeMessage[]) => ({
  messages, agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
  agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
  taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
});
const chain = () => Array.from({ length: 10_000 }, (_, i) => message(`m${i}`, i, i ? `m${i - 1}` : undefined));

describe("deep transcript traversal", () => {
  it("renders every linked message in preorder on the normal stack and preserves source aliases", () => {
    const messages = chain();
    const rows = flattenMessageTree(options(messages));
    const items = rows.filter(row => row.type === "message");
    expect(items).toHaveLength(10_000);
    expect(items.map(row => row.message.uuid)).toEqual(messages.map(m => m.uuid));
    expect(items.every((row, i) => row.message === messages[i] && row.depth === 0 && row.originalIndex === i)).toBe(true);
    expect(buildUuidToIndexMap(rows).size).toBe(10_000);
  });

  it("visits hidden descendants without overflowing or treating them as orphans", () => {
    const rows = flattenMessageTree({ ...options(chain()), hiddenMessageIds: ["m0"] });
    expect(rows).toEqual([{ type: "hidden-placeholder", hiddenCount: 1, hiddenUuids: ["m0"] }]);
  });

  it("keeps stable sibling/root preorder, dates, continuation and duplicate replacement", () => {
    const root = message("root", 0), a = message("a", 1, "root"), b = message("b", 1, "root");
    const old = message("reply", 10, "a"), replacement = { ...old, content: "replacement" };
    const next = message("next", 86_400);
    const rows = flattenMessageTree(options([next, root, b, a, old, replacement]));
    const items = rows.filter(row => row.type === "message");
    expect(items.map(row => [row.message.uuid, row.originalIndex, row.isContinuation])).toEqual([
      ["root", 0, false], ["b", 1, true], ["a", 2, true], ["reply", 3, true], ["next", 4, false],
    ]);
    expect(items.map(row => row.message)).toEqual([root, b, a, replacement, next]);
    expect(items[3]?.message).toBe(replacement);
    expect(rows.filter(row => row.type === "date-divider").map(row => row.timestamp)).toEqual([root.timestamp, next.timestamp]);
    expect([...buildUuidToIndexMap(rows)]).toEqual([["root", 1], ["b", 2], ["a", 3], ["reply", 4], ["next", 6]]);
  });

  it.each([false, true])("preserves chronological fallback and existing hidden policy for disconnected cycles (root=%s)", rooted => {
    const a = message("a", 2, "b"), b = message("b", 1, "a"), self = message("self", 3, "self");
    const root = message("root", 4);
    const rows = flattenMessageTree({ ...options([a, self, ...(rooted ? [root] : []), b]), hiddenMessageIds: ["b"] });
    // Fallback hides b itself but does not suppress a through its disconnected parent.
    expect(rows.map(row => row.type === "message" ? row.message.uuid : row.type)).toEqual([
      "hidden-placeholder", "date-divider", "a", "self", ...(rooted ? ["root"] : []),
    ]);
  });

  it("preserves orphan fallback, command cloning, extras and group aliases", () => {
    const cmd = { ...message("cmd", 1), content: "<command-name>/cost</command-name>", extra: { untouched: true } };
    const stdout = { ...message("stdout", 2, "cmd"), content: "<local-command-stdout>1</local-command-stdout>" };
    const orphan = message("orphan", 0, "outside");
    const progress: ClaudeMessage[] = ["p1", "p2"].map((uuid, i) => ({ ...message(uuid, 3 + i), type: "progress", data: { type: "agent_progress", agentId: "agent" } }));
    const opts = options([cmd, stdout, orphan, ...progress, message("t", 5), message("member", 6), message("op", 7)]);
    const tasks: [] = [], operations: [] = [], registry = new Map();
    opts.agentTaskGroups.set("t", { tasks, messageUuids: new Set(["t", "member"]) });
    opts.agentTaskMemberUuids.add("member");
    opts.agentProgressGroups = groupAgentProgressMessages(progress);
    opts.agentProgressMemberUuids.add("p2");
    opts.taskOperationGroups.set("op", { operations, taskRegistry: registry, messageUuids: new Set(["op"]) });
    const rows = flattenMessageTree(opts).filter(row => row.type === "message");
    expect(rows.map(row => row.message.uuid)).toEqual(["orphan", "cmd", "p1", "p2", "t", "member", "op"]);
    expect(rows[0]?.message).toBe(orphan);
    expect(rows[1]?.message).toEqual({ ...cmd, content: `${cmd.content}\n${stdout.content}` });
    expect(rows[1]?.message).not.toBe(cmd);
    expect((rows[1]?.message as typeof cmd).extra).toBe(cmd.extra);
    expect(cmd.content).toBe("<command-name>/cost</command-name>");
    expect(rows[2]?.agentProgressGroup?.entries).toBe(opts.agentProgressGroups.get("p1")?.entries);
    expect(rows[3]?.isProgressGroupMember).toBe(true);
    expect(rows[4]?.agentTaskGroup).toBe(tasks);
    expect(rows[5]?.isGroupMember).toBe(true);
    expect(rows[6]?.taskOperationGroup).toBe(operations);
    expect(rows[6]?.taskRegistry).toBe(registry);
  });
});
