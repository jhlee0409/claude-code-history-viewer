import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { turnStartKind } from "../../transcript/isTurnStart";
import { getFilteredClassifiedMessages } from "../classifiedRows";
import { groupTurns } from "./groupTurns";
import { getTurnHeaderLabel } from "./turnHeaderLabel";

const message = (uuid: string, content: ClaudeMessage["content"], provider = "codex", type = "user") => ({
  uuid, content, provider, type, role: type, timestamp: "2026-09-26T06:29:32.477Z",
}) as ClaudeMessage;

const cases = [
  ["codex", "<heartbeat>Synthetic wake</heartbeat>"],
  ["claude", "<task-notification><task-id>synthetic-task</task-id><status>completed</status><summary>Synthetic done</summary></task-notification>"],
] as const;

describe("outline automated cycle ownership (owner decision)", () => {
  it("does not repeat a heartbeat-only header as an activity child", () => {
    const groups = groupTurns(getFilteredClassifiedMessages([message("heartbeat", cases[0][1])]));
    expect(groups[0].children).toEqual([]);
    expect(groups[0]).toMatchObject({ kind: "automated", turnStartUuid: "heartbeat", uuids: ["heartbeat"] });
  });

  it("keeps only subsequent work in the heartbeat activity child", () => {
    const groups = groupTurns(getFilteredClassifiedMessages([
      message("heartbeat", cases[0][1]),
      message("reply", "Synthetic reply", "codex", "assistant"),
    ]));
    expect(groups[0].children).toMatchObject([{ type: "activity", navigateUuid: "reply", uuids: ["reply"] }]);
  });

  it("retains every batched notification task with its recorded status", () => {
    const content = "<task-notification><task-id>one</task-id><status>failed</status><summary>Synthetic failure</summary></task-notification>"
      + "<task-notification><task-id>two</task-id><status>completed</status><summary>Synthetic success</summary></task-notification>";
    const groups = groupTurns(getFilteredClassifiedMessages([message("notification", content, "claude")]));
    expect(groups[0].children).toMatchObject([
      { type: "task", taskId: "one", status: "failed", navigateUuid: "notification", uuids: ["notification"] },
      { type: "task", taskId: "two", status: "completed", navigateUuid: "notification", uuids: ["notification"] },
    ]);
  });
  it.each(cases)("keeps %s automated tools out of both adjacent human turns", (provider, content) => {
    const automated = message("automated", content, provider);
    const input = [
      message("human", "Synthetic typed prompt", provider),
      automated,
      message("work", [
        { type: "text", text: "Synthetic automated reply" },
        { type: "tool_use", id: "read", name: "Read", input: { file_path: "/synthetic/a" } },
        { type: "tool_use", id: "bash", name: "Bash", input: { command: "synthetic" } },
      ], provider, "assistant"),
      message("result", [{ type: "tool_result", tool_use_id: "bash", content: "Synthetic result" }], provider),
      message("next-human", "Synthetic next prompt", provider),
    ];
    const groups = groupTurns(getFilteredClassifiedMessages(input));
    expect(groups[0].counts.toolCalls).toBe(0);
    expect(groups.map(group => group.turnStartUuid)).toEqual(["human", "automated", "next-human"]);
    expect(groups.map(group => group.kind)).toEqual(["human", "automated", "human"]);
    expect(groups.map(group => group.turnNumber)).toEqual([1, null, 2]);
    expect(getTurnHeaderLabel(groups[1], false, 2, key => key)).toBe("navigator.kind.agentUpdate");
    expect(groups[1].kind).toBe(turnStartKind(automated, { inSubagent: false }));
    expect(groups[1].counts).toMatchObject({ toolCalls: 2, replies: 1 });
    expect(groups[1].uuids).toEqual(["automated", "work", "result"]);
    expect(groups[2].counts.toolCalls).toBe(0);
  });

  it.each(cases)("keeps consecutive %s automated cycles separate", (provider, content) => {
    const groups = groupTurns(getFilteredClassifiedMessages([
      message("auto-1", content, provider),
      message("tool-1", [{ type: "tool_use", id: "one", name: "Read", input: {} }], provider, "assistant"),
      message("auto-2", content, provider),
      message("tool-2", [{ type: "tool_use", id: "two", name: "Read", input: {} }], provider, "assistant"),
    ]));
    expect(groups.map(group => group.counts.toolCalls)).toEqual([1, 1]);
    expect(groups.map(group => group.kind)).toEqual(["automated", "automated"]);
  });
});
