import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ClaudeMessage } from "../../../types";
import { getFilteredClassifiedMessages } from "../classifiedRows";
import { useOutlineTurns } from "./useOutlineTurns";

const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage => ({
  uuid: "message",
  type: "user",
  role: "user",
  timestamp: "2026-09-26T06:29:32.477Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

describe("useOutlineTurns", () => {
  it("groups the row list into turns, matching groupTurns directly", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]);

    const { result } = renderHook(() => useOutlineTurns(rows));

    expect(result.current).toHaveLength(1);
    expect(result.current[0].key).toBe("p1");
  });

  it("returns the same array instance across re-renders when rows is unchanged", () => {
    const rows = getFilteredClassifiedMessages([
      makeMessage({ uuid: "p1", content: "Scrub for pii" }),
    ]);

    const { result, rerender } = renderHook(({ r }) => useOutlineTurns(r), {
      initialProps: { r: rows },
    });
    const first = result.current;
    rerender({ r: rows });

    expect(result.current).toBe(first);
  });

  it("returns an empty array for an empty row list", () => {
    const { result } = renderHook(() => useOutlineTurns([]));
    expect(result.current).toEqual([]);
  });
});
