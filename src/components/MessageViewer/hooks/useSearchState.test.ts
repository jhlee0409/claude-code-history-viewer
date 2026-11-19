/**
 * The transcript's find field starts empty for another transcript: another
 * session, or another tab even on the same session (T8 review #5 - the find
 * is not carried from one tab into the next).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSearchState } from "./useSearchState";

describe("useSearchState", () => {
  it("clears the field when the transcript it searches changes (session or tab)", () => {
    const onSearchChange = vi.fn();
    const { result, rerender } = renderHook(({ resetKey }) => useSearchState({ onSearchChange, resetKey }), {
      initialProps: { resetKey: "tab-1:s1" },
    });
    act(() => result.current.setSearchQuery("needle"));
    expect(result.current.searchQuery).toBe("needle");

    rerender({ resetKey: "tab-2:s1" });
    expect(result.current.searchQuery).toBe("");

    act(() => result.current.setSearchQuery("again"));
    rerender({ resetKey: "tab-2:s2" });
    expect(result.current.searchQuery).toBe("");
    expect(onSearchChange).toHaveBeenLastCalledWith("");
  });
});
