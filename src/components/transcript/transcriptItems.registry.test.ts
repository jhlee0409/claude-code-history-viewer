import { describe, expect, it, vi } from "vitest";
import { flattenMessageTree } from "../MessageViewer/helpers/flattenMessageTree";
import { buildTranscriptItems } from "./transcriptItems";
import { user } from "./transcriptItems.fixtures";

function fixture(leaders: number, entries: number, suffix = "") {
  const registry = new Map(Array.from({ length: entries }, (_, i) => [`task-${i}`, {
    id: `task-${i}`, subject: `registry-subject-${i}${suffix}`,
  }]));
  const messages = Array.from({ length: leaders }, (_, i) => user(`op-${i}`));
  const rows = flattenMessageTree({
    messages,
    agentTaskGroups: new Map(), agentTaskMemberUuids: new Set(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set(),
    taskOperationGroups: new Map(messages.map(message => [message.uuid, {
      operations: [], taskRegistry: registry, messageUuids: new Set([message.uuid]),
    }])),
    taskOperationMemberUuids: new Set(),
  });
  return { rows, membership: new Map(messages.map(message => [message.uuid, 1] as const)) };
}

describe("shared registry signature complexity", () => {
  it.each([[20, 80], [80, 20], [80, 80]])("serializes O(L+R) values for %i leaders / %i entries", (leaders, entries) => {
    const { rows, membership } = fixture(leaders, entries);
    const before = buildTranscriptItems(rows, membership);
    const serialize = vi.spyOn(JSON, "stringify");
    let after;
    let calls;
    try {
      after = buildTranscriptItems(rows, membership, { previous: before });
      calls = [...serialize.mock.calls];
    } finally {
      serialize.mockRestore();
    }
    expect(after.turns[0]).toBe(before.turns[0]);
    // Count the real serializer, not elapsed time or a mocked signature implementation.
    expect(calls.filter(([value]) => typeof value === "string" && value.startsWith("registry-subject-"))).toHaveLength(entries);
    expect(calls.length).toBeLessThanOrEqual(50 * (leaders + entries));
  });

  it("interns equivalent fresh Maps but rescans changed registry data on the next build", () => {
    const first = fixture(4, 4);
    const before = buildTranscriptItems(first.rows, first.membership);
    const equal = fixture(4, 4);
    const same = buildTranscriptItems(equal.rows, equal.membership, { previous: before });
    expect(same.turns[0]).toBe(before.turns[0]);
    const changed = fixture(4, 4, " changed");
    const after = buildTranscriptItems(changed.rows, changed.membership, { previous: same });
    for (const [id, block] of same.blocks) {
      expect(after.blocks.get(id)).not.toBe(block);
      expect(after.blocks.get(id)?.source.taskRegistry?.get("task-3")?.subject).toBe("registry-subject-3 changed");
      expect(block.source.taskRegistry?.get("task-3")?.subject).toBe("registry-subject-3");
    }
  });
});
