/**
 * #535. Two defects in how a *partial* (windowed) message set is ordered.
 *
 * A session opens with only the newest `MESSAGE_PAGE_SIZE` messages loaded, so
 * most messages' ancestor chains leave the window and are unreachable from any
 * root. That case is handled: with no roots at all, the whole set is rendered
 * chronologically.
 *
 * A `compact_boundary` breaks that. It carries no `parentUuid` (its real parent
 * is in `logicalParentUuid`), so it *is* a root, `rootMessages` is not empty,
 * and the chronological fallback is skipped. Whatever DFS reaches from the
 * boundary is then pinned above everything older, because the recovery step
 * appends rather than merges — and the recovery only runs below a 0.9 coverage
 * threshold, so between 90% and 100% the unreachable messages are dropped with
 * no placeholder and no warning outside DEV builds.
 */
import { describe, it, expect } from "vitest";
import { flattenMessageTree } from "./flattenMessageTree";
import type { ClaudeMessage } from "../../../types";

const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute, 0)).toISOString();

const msg = (
  uuid: string,
  minute: number,
  parentUuid?: string
): ClaudeMessage => ({
  uuid,
  ...(parentUuid === undefined ? {} : { parentUuid }),
  timestamp: at(minute),
  sessionId: "s1",
  type: "user",
  role: "user",
  content: `content of ${uuid}`,
});

/**
 * A compaction boundary. The point of the fixture is that it has no
 * `parentUuid` — its parent link is logical — so the tree walk treats it as a
 * root even though older messages precede it.
 */
const boundary = (uuid: string, minute: number): ClaudeMessage => ({
  uuid,
  timestamp: at(minute),
  sessionId: "s1",
  type: "system",
  content: "compacted",
});

const renderedUuids = (messages: ClaudeMessage[]): string[] => {
  const flattened = flattenMessageTree({
    messages,
    agentTaskGroups: new Map(),
    agentTaskMemberUuids: new Set(),
    agentProgressGroups: new Map(),
    agentProgressMemberUuids: new Set(),
    taskOperationGroups: new Map(),
    taskOperationMemberUuids: new Set(),
  });

  const uuids: string[] = [];
  for (const item of flattened) {
    // Narrowed by the discriminant rather than cast: the union also carries
    // date dividers and hidden-block placeholders, which have no message.
    if (item.type === "message") {
      uuids.push(item.message.uuid);
    }
  }
  return uuids;
};

describe("flattenMessageTree on a windowed message set", () => {
  /**
   * The shape a user actually meets: older messages whose parents fell outside
   * the window, then a compaction boundary and the exchange after it.
   */
  const windowed = (): ClaudeMessage[] => [
    // Unreachable: their oldest ancestor is not in the window.
    msg("old-1", 1, "outside-the-window"),
    msg("old-2", 2, "old-1"),
    msg("old-3", 3, "old-2"),
    // A root, so the chronological fallback is skipped.
    boundary("bnd", 4),
    msg("new-1", 5, "bnd"),
    msg("new-2", 6, "new-1"),
  ];

  it("renders in chronological order rather than hoisting the boundary", () => {
    expect(renderedUuids(windowed())).toEqual([
      "old-1",
      "old-2",
      "old-3",
      "bnd",
      "new-1",
      "new-2",
    ]);
  });

  it("never steps backwards in time", () => {
    // The property, stated independently of the fixture. This is what a user
    // sees as "the top of the conversation is dated after what follows it".
    const all = windowed();
    const times = renderedUuids(all).map((uuid) =>
      new Date(all.find((m) => m.uuid === uuid)!.timestamp).getTime()
    );

    for (let i = 1; i < times.length; i++) {
      expect(
        times[i]! >= times[i - 1]!,
        `render position ${i} goes backwards in time`
      ).toBe(true);
    }
  });

  it("drops nothing when coverage is just under 100%", () => {
    // The 0.9 threshold is a cliff. One unreachable message out of twelve is
    // ~92% coverage, so the recovery never ran and that message was silently
    // discarded — no placeholder, and no warning outside DEV.
    const all: ClaudeMessage[] = [
      msg("orphan", 1, "outside-the-window"),
      boundary("bnd", 2),
    ];
    for (let i = 3; i <= 12; i++) {
      all.push(msg(`c-${i}`, i, i === 3 ? "bnd" : `c-${i - 1}`));
    }

    const order = renderedUuids(all);

    expect(order).toHaveLength(all.length);
    expect(order).toContain("orphan");
  });

  it("still walks the tree when the window holds a complete conversation", () => {
    // Fully reachable, so DFS order is meaningful and must be kept: a branch
    // whose reply arrives later than the next sibling still renders under its
    // own parent rather than being re-sorted away from it.
    const all: ClaudeMessage[] = [
      msg("root", 1),
      msg("a", 2, "root"),
      msg("a-reply", 5, "a"),
      msg("b", 3, "root"),
      msg("b-reply", 4, "b"),
    ];

    expect(renderedUuids(all)).toEqual([
      "root",
      "a",
      "a-reply",
      "b",
      "b-reply",
    ]);
  });
});
