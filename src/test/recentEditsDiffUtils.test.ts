import { describe, it, expect } from "vitest";
import {
  extractAddedLines,
  extractRemovedLines,
} from "../components/RecentEditsViewer/diffUtils";

describe("recentEdits diffUtils", () => {
  const oldText = ["line 1", "line 2", "line 3", "line 4"].join("\n");

  it("extracts added lines with 1-based line numbers in the new file", () => {
    const newText = ["line 1", "inserted A", "line 2", "line 3", "line 4", "appended B"].join(
      "\n"
    );

    const groups = extractAddedLines(oldText, newText);

    expect(groups).toEqual([
      { startLine: 2, lines: ["inserted A"] },
      { startLine: 6, lines: ["appended B"] },
    ]);
  });

  it("extracts removed lines with 1-based line numbers in the old file", () => {
    const newText = ["line 1", "line 4"].join("\n");

    const groups = extractRemovedLines(oldText, newText);

    expect(groups).toEqual([{ startLine: 2, lines: ["line 2", "line 3"] }]);
  });

  it("treats a modified line as one removed and one added line", () => {
    const newText = ["line 1", "line 2 changed", "line 3", "line 4"].join("\n");

    expect(extractAddedLines(oldText, newText)).toEqual([
      { startLine: 2, lines: ["line 2 changed"] },
    ]);
    expect(extractRemovedLines(oldText, newText)).toEqual([
      { startLine: 2, lines: ["line 2"] },
    ]);
  });

  it("counts every line as added for newly created files (no original content)", () => {
    const newText = ["fn main() {", "}"].join("\n");

    expect(extractAddedLines(undefined, newText)).toEqual([
      { startLine: 1, lines: ["fn main() {", "}"] },
    ]);
    expect(extractRemovedLines(undefined, newText)).toEqual([]);
  });

  it("returns empty groups when nothing changed", () => {
    expect(extractAddedLines(oldText, oldText)).toEqual([]);
    expect(extractRemovedLines(oldText, oldText)).toEqual([]);
  });

  it("handles trailing newlines without producing phantom empty lines", () => {
    const withTrailing = "a\nb\n";
    const newText = "a\nb\nc\n";

    expect(extractAddedLines(withTrailing, newText)).toEqual([
      { startLine: 3, lines: ["c"] },
    ]);
  });

  it("handles multiple contiguous hunks independently", () => {
    const before = ["1", "2", "3", "4", "5", "6"].join("\n");
    const after = ["1", "x", "3", "4", "y", "z", "6"].join("\n");

    expect(extractAddedLines(before, after)).toEqual([
      { startLine: 2, lines: ["x"] },
      { startLine: 5, lines: ["y", "z"] },
    ]);
    expect(extractRemovedLines(before, after)).toEqual([
      { startLine: 2, lines: ["2"] },
      { startLine: 5, lines: ["5"] },
    ]);
  });
});
