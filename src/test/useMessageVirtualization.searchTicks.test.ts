import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import { groupTaskOperations } from "@/components/MessageViewer/helpers/taskOperationHelpers";
import { isZeroHeightMessageRow } from "@/components/MessageViewer/helpers/heightEstimation";
import { minimapTicks } from "@/components/MessageViewer/helpers/minimapLayout";

const message = (uuid: string, second: number, content: ClaudeMessage["content"] = uuid): ClaudeMessage => ({
  uuid, sessionId: "task-search", type: "assistant", content,
  timestamp: `2026-06-29T22:01:0${second}.000Z`,
});

function taskFixture(): Parameters<typeof useMessageVirtualization>[0] {
  const messages = [
    message("leader", 0, [{ type: "tool_use", id: "create", name: "TaskCreate", input: { subject: "Task" } }]),
    message("member", 1, [{ type: "tool_use", id: "update", name: "TaskUpdate", input: { taskId: "1", description: "hidden needle" } }]),
    message("ordinary", 2),
  ];
  const taskOperationGroups = groupTaskOperations(messages);
  return {
    messages,
    agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
    taskOperationGroups,
    taskOperationMemberUuids: new Set([...taskOperationGroups.values()].flatMap(group => [...group.messageUuids])),
    getScrollElement: () => null,
  };
}

describe("real message resolver → minimap search ticks", () => {
  it.each([false, true])("places a hidden TaskUpdate match on its visible Task Operations leader (current=%s)", current => {
    const { result } = renderHook(() => useMessageVirtualization(taskFixture()));
    const { flattenedMessages, uuidToIndexMap, getScrollIndex } = result.current;
    const leader = uuidToIndexMap.get("leader")!;
    const member = uuidToIndexMap.get("member")!;
    expect(leader).not.toBe(member);
    expect(flattenedMessages[leader]).toMatchObject({ isTaskOperationGroupLeader: true });
    expect(flattenedMessages[member]).toMatchObject({ isTaskOperationGroupMember: true });
    expect(isZeroHeightMessageRow(flattenedMessages[member]!, false)).toBe(true);
    expect(isZeroHeightMessageRow(flattenedMessages[leader]!, false)).toBe(false);

    // Distinct measured positions: the zero-height member shares the NEXT
    // ordinary row's start, not the visible leader's. Do not mock the resolver.
    const measurements = flattenedMessages.map((_, index) => ({ start: index < member ? 126 : 210, size: index === member ? 0 : 84 }));
    const resolved = getScrollIndex("member")!;
    expect(minimapTicks({
      rowIndices: [resolved], currentRowIndex: current ? resolved : -1,
      measurements, scale: 1, offset: 0, mapHeight: 708,
    })).toEqual([{ y: 126, height: current ? 4 : 2, current }]);
    expect(resolved).toBe(leader);
  });

  it("keeps leader, ordinary and unloaded UUID controls unchanged", () => {
    const { result } = renderHook(() => useMessageVirtualization(taskFixture()));
    for (const uuid of ["leader", "ordinary"]) {
      expect(result.current.getScrollIndex(uuid)).toBe(result.current.uuidToIndexMap.get(uuid));
    }
    expect(result.current.getScrollIndex("not-loaded")).toBeNull();
  });

  it.each(["agent-task", "agent-progress"] as const)("preserves %s member-to-leader navigation", kind => {
    const options = taskFixture();
    const group = { messageUuids: new Set(["agent-leader", "agent-member"]) };
    options.messages = [message("agent-leader", 0), message("agent-member", 1), message("ordinary", 2)];
    if (kind === "agent-task") {
      options.agentTaskGroups.set("agent-leader", { ...group, tasks: [] });
      options.agentTaskMemberUuids = group.messageUuids;
    } else {
      options.agentProgressGroups.set("agent-leader", { ...group, entries: [] });
      options.agentProgressMemberUuids = group.messageUuids;
    }
    const { result } = renderHook(() => useMessageVirtualization(options));
    expect(result.current.getScrollIndex("agent-member")).toBe(result.current.uuidToIndexMap.get("agent-leader"));
    expect(result.current.getScrollIndex("ordinary")).toBe(result.current.uuidToIndexMap.get("ordinary"));
  });
});
