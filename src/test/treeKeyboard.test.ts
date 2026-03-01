import { describe, expect, it } from "vitest";
import {
  buildTreeItemAnnouncement,
  findTypeaheadMatchIndex,
  getNextTreeItemIndex,
} from "@/components/ProjectTree/treeKeyboard";

describe("getNextTreeItemIndex", () => {
  it("moves down within bounds", () => {
    expect(getNextTreeItemIndex(0, 4, "ArrowDown")).toBe(1);
    expect(getNextTreeItemIndex(3, 4, "ArrowDown")).toBe(3);
  });

  it("moves up within bounds", () => {
    expect(getNextTreeItemIndex(2, 4, "ArrowUp")).toBe(1);
    expect(getNextTreeItemIndex(0, 4, "ArrowUp")).toBe(0);
  });

  it("supports home and end", () => {
    expect(getNextTreeItemIndex(2, 5, "Home")).toBe(0);
    expect(getNextTreeItemIndex(1, 5, "End")).toBe(4);
  });

  it("returns -1 when there are no items", () => {
    expect(getNextTreeItemIndex(0, 0, "ArrowDown")).toBe(-1);
  });

  it("finds next matching typeahead item with wrap-around", () => {
    const labels = ["Global Statistics", "Alpha", "Beta", "Gamma"];
    expect(findTypeaheadMatchIndex(labels, 1, "g")).toBe(3);
    expect(findTypeaheadMatchIndex(labels, 3, "a")).toBe(1);
  });

  it("returns -1 when typeahead has no match", () => {
    const labels = ["Alpha", "Beta", "Gamma"];
    expect(findTypeaheadMatchIndex(labels, 0, "z")).toBe(-1);
  });

  it("builds tree item announcement with expanded and selected state", () => {
    const result = buildTreeItemAnnouncement(
      "  Project Alpha  ",
      { ariaExpanded: "true", ariaSelected: "true" },
      { expanded: "expanded", collapsed: "collapsed", selected: "selected" },
      "Explorer"
    );

    expect(result).toBe("Project Alpha, expanded, selected");
  });

  it("uses fallback label for empty node text", () => {
    const result = buildTreeItemAnnouncement(
      "   ",
      { ariaExpanded: null, ariaSelected: null },
      { expanded: "expanded", collapsed: "collapsed", selected: "selected" },
      "Explorer"
    );

    expect(result).toBe("Explorer");
  });
});
