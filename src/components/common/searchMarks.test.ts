/**
 * The one search-hit rule (CodeRabbit on PR #733): ranges use the same
 * trimmed query that decides a row is a hit (`searchHits`, the session
 * search index), so a padded query still marks what it counted.
 */
import { describe, expect, it } from "vitest";
import { searchRanges } from "./searchMarks";
import { searchHits } from "@/components/contentRenderer/unifiedCards/shared";

describe("searchRanges", () => {
  it("marks the same hits for a padded query as for the trimmed one", () => {
    expect(searchRanges("status: pending", " pending ")).toEqual(searchRanges("status: pending", "pending"));
    expect(searchRanges("status: pending", " pending ")).toEqual([[8, 15]]);
  });

  it("every text searchHits counts has at least one range, padded or not", () => {
    for (const q of ["pending", " pending", "pending ", "  PENDING  "]) {
      expect(searchHits(q, "Pending review")).toBe(true);
      expect(searchRanges("Pending review", q).length, JSON.stringify(q)).toBeGreaterThan(0);
    }
  });

  it("a blank query has none; inner spaces stay part of the query", () => {
    expect(searchRanges("a b", "   ")).toEqual([]);
    expect(searchRanges("a  b a b", " a b ")).toEqual([[5, 8]]);
  });
});
