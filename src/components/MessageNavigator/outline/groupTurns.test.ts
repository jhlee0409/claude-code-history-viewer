import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import { getFilteredClassifiedMessages } from "../classifiedRows";
import { groupTurns } from "./groupTurns";
import { LEADING_TURN_KEY, type OutlineTaskChild } from "./types";

const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage => ({
  uuid: "message",
  type: "user",
  role: "user",
  timestamp: "2026-09-26T06:29:32.477Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

function rows(messages: ClaudeMessage[]) {
  return getFilteredClassifiedMessages(messages);
}

describe("groupTurns", () => {
  it("returns an empty array for no rows", () => {
    expect(groupTurns([])).toEqual([]);
  });

  it("treats a window with no turn start at all as one leading group", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "u1", content: "<local-command-stdout>ok</local-command-stdout>" }),
      makeMessage({
        uuid: "u2",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      }),
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(LEADING_TURN_KEY);
    expect(groups[0].turnStartUuid).toBeNull();
    expect(groups[0].turnNumber).toBeNull();
    expect(groups[0].header).toBeNull();
    expect(groups[0].firstUuid).toBe("u1");
    expect(groups[0].uuids).toEqual(["u1", "u2"]);
    expect(groups[0].children.map((c) => c.key)).toEqual(["u1", "u2"]);
  });

  it("omits the leading group when the first row is already a turn start", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("p1");
    expect(groups[0].turnStartUuid).toBe("p1");
    expect(groups[0].turnNumber).toBe(1);
  });

  it("puts rows before the first prompt into a non-empty leading group, numbers only real turns", () => {
    const groups = groupTurns(rows([
      makeMessage({
        uuid: "lead1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Welcome back." }],
      }),
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
      makeMessage({ uuid: "p2", content: "Push to gh" }),
    ]));

    expect(groups.map((g) => g.key)).toEqual([LEADING_TURN_KEY, "p1", "p2"]);
    expect(groups[0].turnNumber).toBeNull();
    expect(groups[1].turnNumber).toBe(1);
    expect(groups[2].turnNumber).toBe(2);
  });

  it("starts a turn at a slash command invocation but not at its local output", () => {
    const groups = groupTurns(rows([
      makeMessage({
        uuid: "cmd1",
        content: "<command-message>init is analyzing your codebase…</command-message>\n<command-name>/init</command-name>",
      }),
      makeMessage({ uuid: "out1", content: "<local-command-stdout>ok</local-command-stdout>" }),
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("cmd1");
    expect(groups[0].children.map((c) => c.key)).toEqual(["out1"]);
  });

  it("excludes the turn-start row from children; the header represents it", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [{ type: "text", text: "Scrubbing now." }],
      }),
    ]));

    expect(groups[0].header?.uuid).toBe("p1");
    expect(groups[0].children).toHaveLength(1);
    expect(groups[0].children[0].key).toBe("r1");
    expect(groups[0].uuids).toEqual(["p1", "r1"]);
  });

  it("counts replies, tool calls (including a reply row's own tool_use blocks), agent updates", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
      // reply with text AND two tool_use blocks
      makeMessage({
        uuid: "r1",
        type: "assistant",
        role: "assistant",
        content: [
          { type: "text", text: "Scrubbing first, then pushing." },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
          { type: "tool_use", id: "toolu_2", name: "Read", input: {} },
        ],
      }),
      // tool-only assistant message
      makeMessage({
        uuid: "r2",
        type: "assistant",
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_3", name: "Write", input: {} }],
      }),
      // user tool-result message carrying top-level toolUseResult
      makeMessage({
        uuid: "r3",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
        toolUseResult: { stdout: "ok" },
      }),
      // agent update with two blocks for two different task ids (batched)
      makeMessage({
        uuid: "a1",
        content: [
          "<task-notification><task-id>task-a</task-id><status>running</status><summary>Task A</summary></task-notification>",
          "<task-notification><task-id>task-b</task-id><status>running</status><summary>Task B</summary></task-notification>",
        ].join("\n"),
      }),
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0].counts).toEqual({
      replies: 1,
      // r1 (2 tool_use blocks) + r2 (1) = 3; r3 is a "tool" row carrying no
      // tool_use content block (toolUseResult only), so it contributes 0.
      toolCalls: 3,
      agentsStarted: 2,
      agentUpdates: 1,
    });
  });

  it("does not count a task with zero updates among agentsStarted (none observed yet)", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]));

    expect(groups[0].counts.agentsStarted).toBe(0);
    expect(groups[0].counts.agentUpdates).toBe(0);
  });

  it("groups batched multi-task notifications into one row per task, in first-appearance order", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch two agents" }),
      makeMessage({
        uuid: "a1",
        content: [
          "<task-notification><task-id>task-a</task-id><status>running</status><summary>Task A running</summary></task-notification>",
          "<task-notification><task-id>task-b</task-id><status>running</status><summary>Task B running</summary></task-notification>",
        ].join("\n"),
      }),
    ]));

    const children = groups[0].children;
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.type === "task")).toBe(true);
    const taskA = children[0] as OutlineTaskChild;
    const taskB = children[1] as OutlineTaskChild;
    expect(taskA.taskId).toBe("task-a");
    expect(taskA.updateCount).toBe(1);
    expect(taskB.taskId).toBe("task-b");
    expect(taskB.updateCount).toBe(1);
  });

  it("merges later updates for the same task id into the same row, bumping updateCount", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>running</status><summary>Task A starting</summary></task-notification>",
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>running</status><summary>Task A halfway</summary></task-notification>",
      }),
    ]));

    const children = groups[0].children;
    expect(children).toHaveLength(1);
    const task = children[0] as OutlineTaskChild;
    expect(task.updateCount).toBe(2);
    expect(task.label).toBe("Task A halfway");
    expect(task.navigateUuid).toBe("a2");
    expect(task.timestamp).toBe("2026-09-26T06:29:32.477Z");
  });

  it("keeps a task's status failed even when a later block reports a different non-failed status", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>failed</status><summary>Task A failed</summary></task-notification>",
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>completed</status><summary>Task A completed</summary></task-notification>",
      }),
    ]));

    const task = groups[0].children[0] as OutlineTaskChild;
    expect(task.status).toBe("failed");
    // The label still tracks the last non-empty summary regardless of status.
    expect(task.label).toBe("Task A completed");
  });

  it("tracks the most recent status when no failure has occurred", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>running</status></task-notification>",
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>completed</status></task-notification>",
      }),
    ]));

    const task = groups[0].children[0] as OutlineTaskChild;
    expect(task.status).toBe("completed");
  });

  it("flips a running task to failed the moment any block reports a failed status", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>running</status></task-notification>",
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>failed</status></task-notification>",
      }),
    ]));

    const task = groups[0].children[0] as OutlineTaskChild;
    expect(task.status).toBe("failed");
  });

  it("updates to a second failed value when another failed status follows the first", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>failed</status></task-notification>",
      }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>error</status></task-notification>",
      }),
    ]));

    const task = groups[0].children[0] as OutlineTaskChild;
    expect(task.status).toBe("error");
  });

  it("gives a block with no task-id its own row, keyed by row uuid and block index", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch something" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><status>running</status><summary>No id</summary></task-notification>",
      }),
    ]));

    const children = groups[0].children;
    expect(children).toHaveLength(1);
    const task = children[0] as OutlineTaskChild;
    expect(task.type).toBe("task");
    expect(task.taskId).toBeUndefined();
    expect(task.key).toBe("p1::task:a1:0");
  });

  it("builds unique child keys across different turns for the same task id", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>running</status></task-notification>",
      }),
      makeMessage({ uuid: "p2", content: "Launch it again" }),
      makeMessage({
        uuid: "a2",
        content: "<task-notification><task-id>task-a</task-id><status>running</status></task-notification>",
      }),
    ]));

    expect(groups).toHaveLength(2);
    const firstTurnKey = (groups[0].children[0] as OutlineTaskChild).key;
    const secondTurnKey = (groups[1].children[0] as OutlineTaskChild).key;
    expect(firstTurnKey).toBe("p1::task:task-a");
    expect(secondTurnKey).toBe("p2::task:task-a");
    expect(firstTurnKey).not.toBe(secondTurnKey);
  });

  it("keeps an agent-update row's uuid in the group's uuids even though it is collapsed into a task child", () => {
    const groups = groupTurns(rows([
      makeMessage({ uuid: "p1", content: "Launch an agent" }),
      makeMessage({
        uuid: "a1",
        content: "<task-notification><task-id>task-a</task-id><status>running</status></task-notification>",
      }),
    ]));

    expect(groups[0].uuids).toEqual(["p1", "a1"]);
  });
});
