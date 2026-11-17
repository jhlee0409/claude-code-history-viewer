import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { flattenMessageTree } from "./flattenMessageTree";
import { groupAgentProgressMessages } from "./agentProgressHelpers";

const message = (uuid: string, content: string, timestamp = "2026-01-01T12:00:00Z", parentUuid?: string): ClaudeMessage => ({
  uuid, content, timestamp, parentUuid, sessionId: "s", type: "user", role: "user",
});
const options = (messages: ClaudeMessage[]) => ({
  messages, agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
  agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
  taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
});

describe("TR3 pre-model flatten characterization", () => {
  it("merges command stdout into its parent without mutating the input", () => {
    const command = message("cmd", "<command-name>/cost</command-name>");
    const output = message("out", "<local-command-stdout>cost: 1</local-command-stdout>", undefined, "cmd");
    const rows = flattenMessageTree(options([command, output])).filter(r => r.type === "message");
    expect(rows.map(r => r.message.uuid)).toEqual(["cmd"]);
    expect(rows[0]?.message.content).toBe(`${command.content}\n${output.content}`);
    expect(command.content).toBe("<command-name>/cost</command-name>");
  });

  it("sorts a wholly rootless page chronologically and keeps equal-time source order", () => {
    const rows = flattenMessageTree(options([
      message("late", "l", "2026-01-01T13:00:00Z", "missing"),
      message("first", "f", undefined, "missing"), message("tie", "t", undefined, "missing"),
    ]));
    expect(rows.filter(r => r.type === "message").map(r => r.message.uuid)).toEqual(["first", "tie", "late"]);
  });

  it("inserts only the first and changed-day dividers", () => {
    const rows = flattenMessageTree(options([message("a", "a"), message("b", "b"), message("c", "c", "2026-01-03T12:00:00Z")]));
    expect(rows.map(r => r.type)).toEqual(["date-divider", "message", "message", "date-divider", "message"]);
  });

  it("capture hiding owns placeholders and suppresses descendants of a hidden parent", () => {
    const rows = flattenMessageTree({ ...options([message("a", "a"), message("child", "child", undefined, "a"), message("b", "b")]), hiddenMessageIds: ["a"] });
    expect(rows.map(r => r.type)).toEqual(["hidden-placeholder", "date-divider", "message"]);
    expect(rows[0]).toEqual({ type: "hidden-placeholder", hiddenCount: 1, hiddenUuids: ["a"] });
    expect(rows.at(-1)).toMatchObject({ message: { uuid: "b" }, originalIndex: 0, isContinuation: false });
  });

  it("attaches task, progress and operation groups without replacing member rows", () => {
    const progress: ClaudeMessage[] = ["p1", "p2"].map(uuid => ({
      uuid, sessionId: "s", timestamp: "2026-01-01T12:00:00Z", type: "progress", data: { type: "agent_progress", agentId: "agent" },
    }));
    const opts = options([message("t1", "task"), message("t2", "task"), ...progress, message("o1", "op"), message("o2", "op")]);
    opts.agentTaskGroups.set("t1", { tasks: [], messageUuids: new Set(["t1", "t2"]) });
    opts.agentTaskMemberUuids.add("t2");
    opts.agentProgressGroups = groupAgentProgressMessages(progress);
    opts.agentProgressMemberUuids.add("p2");
    opts.taskOperationGroups.set("o1", { operations: [], taskRegistry: new Map(), messageUuids: new Set(["o1", "o2"]) });
    opts.taskOperationMemberUuids.add("o2");
    const rows = flattenMessageTree(opts).filter(r => r.type === "message");
    expect(rows.map(r => r.message.uuid)).toEqual(["t1", "t2", "p1", "p2", "o1", "o2"]);
    expect(rows[0]).toMatchObject({ isGroupLeader: true, agentTaskGroup: [] });
    expect(rows[1]).toMatchObject({ isGroupMember: true });
    expect(rows[2]?.agentProgressGroup?.entries).toHaveLength(2);
    expect(rows[3]).toMatchObject({ isProgressGroupMember: true });
    expect(rows[4]).toMatchObject({ isTaskOperationGroupLeader: true, taskOperationGroup: [] });
    expect(rows[5]).toMatchObject({ isTaskOperationGroupMember: true });
  });
});
