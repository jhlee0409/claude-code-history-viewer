import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import { getFilteredClassifiedMessages } from "../classifiedRows";
import { groupTurns } from "./groupTurns";
import { findTurnKeyForUuid, flattenOutlineRows, rowHoldsUuid } from "./flattenOutline";

const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage => ({
  uuid: "message",
  type: "user",
  role: "user",
  timestamp: "2026-09-26T06:29:32.477Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

function buildTurns(messages: ClaudeMessage[]) {
  return groupTurns(getFilteredClassifiedMessages(messages));
}

const sampleMessages: ClaudeMessage[] = [
  makeMessage({ uuid: "p1", content: "First prompt" }),
  makeMessage({
    uuid: "r1",
    type: "assistant",
    role: "assistant",
    content: [{ type: "text", text: "First reply." }],
  }),
  makeMessage({ uuid: "p2", content: "Second prompt" }),
  makeMessage({
    uuid: "r2",
    type: "assistant",
    role: "assistant",
    content: [{ type: "text", text: "Second reply." }],
  }),
];

describe("flattenOutlineRows", () => {
  it("always includes turn headers, with 1-based posInSet/setSize among turns", () => {
    const turns = buildTurns(sampleMessages);
    const flat = flattenOutlineRows(turns, new Set());

    expect(flat.map((row) => row.type)).toEqual(["turn", "turn"]);
    expect(flat[0]).toMatchObject({ key: "p1", posInSet: 1, setSize: 2 });
    expect(flat[1]).toMatchObject({ key: "p2", posInSet: 2, setSize: 2 });
  });

  it("includes children only for open turns, with 1-based posInSet/setSize within their turn", () => {
    const turns = buildTurns(sampleMessages);
    const flat = flattenOutlineRows(turns, new Set(["p1"]));

    // r1 (a reply) folds into p1's activity child, keyed off the turn.
    expect(flat.map((row) => row.key)).toEqual(["p1", "p1::activity", "p2"]);
    expect(flat[0]).toMatchObject({ type: "turn", isOpen: true });
    expect(flat[1]).toMatchObject({ type: "child", turnKey: "p1", posInSet: 1, setSize: 1 });
    expect(flat[2]).toMatchObject({ type: "turn", isOpen: false });
  });

  it("opens every turn whose key is in openKeys", () => {
    const turns = buildTurns(sampleMessages);
    const flat = flattenOutlineRows(turns, new Set(["p1", "p2"]));

    expect(flat.map((row) => row.key)).toEqual([
      "p1",
      "p1::activity",
      "p2",
      "p2::activity",
    ]);
  });

  it("returns an empty array for no turns", () => {
    expect(flattenOutlineRows([], new Set())).toEqual([]);
  });
});

describe("findTurnKeyForUuid", () => {
  it("finds the turn containing a given message uuid, including header uuids", () => {
    const turns = buildTurns(sampleMessages);
    expect(findTurnKeyForUuid(turns, "p1")).toBe("p1");
    expect(findTurnKeyForUuid(turns, "r1")).toBe("p1");
    expect(findTurnKeyForUuid(turns, "p2")).toBe("p2");
    expect(findTurnKeyForUuid(turns, "r2")).toBe("p2");
  });

  it("returns null for a uuid in no turn, and for a null uuid", () => {
    const turns = buildTurns(sampleMessages);
    expect(findTurnKeyForUuid(turns, "does-not-exist")).toBeNull();
    expect(findTurnKeyForUuid(turns, null)).toBeNull();
  });
});

describe("rowHoldsUuid", () => {
  it("is true for an activity row when the uuid is one of its collapsed rows", () => {
    const turns = buildTurns(sampleMessages);
    const flat = flattenOutlineRows(turns, new Set(["p1"]));
    const activityRow = flat.find((row) => row.key === "p1::activity");
    if (!activityRow) throw new Error("expected an activity row");

    // r1 is the single reply collapsed into p1's activity child.
    expect(rowHoldsUuid(activityRow, "r1")).toBe(true);
    expect(rowHoldsUuid(activityRow, "does-not-exist")).toBe(false);
  });

  it("is true for a header row only for its own uuid", () => {
    const turns = buildTurns(sampleMessages);
    const flat = flattenOutlineRows(turns, new Set());
    const header = flat.find((row) => row.key === "p1");
    if (!header) throw new Error("expected a header row");

    expect(rowHoldsUuid(header, "p1")).toBe(true);
    expect(rowHoldsUuid(header, "r1")).toBe(false);
  });
});
