import { describe, expect, it } from "vitest";
import type { ClaudeMessage, ConversationBranches } from "@/types";
import {
  branchSwitchesByMessage,
  createShownPathFilter,
  filterToShownPath,
  NO_BRANCH_SELECTIONS,
  selectionsShowing,
} from "./conversationBranches";

const message = (uuid: string): ClaudeMessage =>
  ({ uuid, type: "user", timestamp: "2026-01-01T00:00:00Z", sessionId: "s" }) as ClaudeMessage;

/**
 * u1 → a1 forks into `old` (old, old-a) and `new` (new, new-a); inside
 * `old`, old-a forks again into x and y. Claude Code resumes `new`.
 */
const branches: ConversationBranches = {
  points: [
    { parentUuid: "a1", optionIds: [0, 1], defaultOption: 1, parentOption: null },
    { parentUuid: "old-a", optionIds: [2, 3], defaultOption: 3, parentOption: 0 },
  ],
  options: [
    { point: 0, headUuid: "old", anchorUuid: "old" },
    { point: 0, headUuid: "new", anchorUuid: "new" },
    { point: 1, headUuid: "x", anchorUuid: "x" },
    { point: 1, headUuid: "y", anchorUuid: "y" },
  ],
  membership: { old: 0, "old-a": 0, new: 1, "new-a": 1, x: 2, y: 3 },
};

const fileOrder = ["u1", "a1", "old", "old-a", "x", "y", "new", "new-a"].map(message);
const uuids = (messages: ClaudeMessage[]) => messages.map((m) => m.uuid);

describe("filterToShownPath", () => {
  it("shows the path Claude Code resumes until another alternative is chosen", () => {
    expect(uuids(filterToShownPath(fileOrder, branches, NO_BRANCH_SELECTIONS))).toEqual([
      "u1", "a1", "new", "new-a",
    ]);
    expect(uuids(filterToShownPath(fileOrder, branches, { a1: "old" }))).toEqual([
      "u1", "a1", "old", "old-a", "y",
    ]);
    expect(uuids(filterToShownPath(fileOrder, branches, { a1: "old", "old-a": "x" }))).toEqual([
      "u1", "a1", "old", "old-a", "x",
    ]);
  });

  it("keeps the array itself when nothing is hidden, and ignores an unknown choice", () => {
    const linear = ["u1", "a1"].map(message);
    expect(filterToShownPath(linear, branches, NO_BRANCH_SELECTIONS)).toBe(linear);
    expect(filterToShownPath(fileOrder, null, NO_BRANCH_SELECTIONS)).toBe(fileOrder);
    expect(uuids(filterToShownPath(fileOrder, branches, { a1: "gone" }))).toEqual([
      "u1", "a1", "new", "new-a",
    ]);
  });

  it("filters a window that holds neither the fork nor its older alternative", () => {
    const window = ["old-a", "y", "new", "new-a"].map(message);
    expect(uuids(filterToShownPath(window, branches, NO_BRANCH_SELECTIONS))).toEqual(["new", "new-a"]);
  });

  it("remembers its last answer until an input changes", () => {
    const filter = createShownPathFilter();
    const first = filter(fileOrder, branches, NO_BRANCH_SELECTIONS);
    expect(filter(fileOrder, branches, NO_BRANCH_SELECTIONS)).toBe(first);
    expect(filter(fileOrder, branches, { a1: "old" })).not.toBe(first);
  });
});

describe("selectionsShowing", () => {
  it("switches every fork above a hidden message to the alternative holding it", () => {
    expect(selectionsShowing("x", branches, NO_BRANCH_SELECTIONS)).toEqual({ a1: "old", "old-a": "x" });
  });

  it("returns the same selections when the message is already shown", () => {
    const selections = { a1: "new" };
    expect(selectionsShowing("new-a", branches, selections)).toBe(selections);
    expect(selectionsShowing("u1", branches, selections)).toBe(selections);
    expect(selectionsShowing("x", null, selections)).toBe(selections);
  });
});

describe("branchSwitchesByMessage", () => {
  it("puts a fork's switcher below the message it forks from", () => {
    const switches = branchSwitchesByMessage(["u1", "a1", "new", "new-a"], branches, NO_BRANCH_SELECTIONS);
    expect([...switches.keys()]).toEqual(["a1"]);
    expect(switches.get("a1")).toEqual([
      { parentUuid: "a1", headUuids: ["old", "new"], position: 1, placement: "after" },
    ]);
  });

  it("falls back to the first shown row of the alternative when the fork's message is not on screen", () => {
    // A window starting inside the first alternative: a1 and old are older.
    const switches = branchSwitchesByMessage(["old-a", "y"], branches, { a1: "old" });
    expect(switches.get("old-a")).toEqual([
      { parentUuid: "old-a", headUuids: ["x", "y"], position: 1, placement: "after" },
      { parentUuid: "a1", headUuids: ["old", "new"], position: 0, placement: "before" },
    ]);
  });

  it("draws no switcher for a fork inside an alternative that is not shown", () => {
    const switches = branchSwitchesByMessage(["u1", "a1", "new"], branches, NO_BRANCH_SELECTIONS);
    expect([...switches.values()].flat().map((s) => s.parentUuid)).toEqual(["a1"]);
  });
});
