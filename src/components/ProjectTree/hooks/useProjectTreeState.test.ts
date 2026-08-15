import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useProjectTreeState } from "./useProjectTreeState";

describe("useProjectTreeState", () => {
  it("ensures a selected project and its group are expanded", () => {
    const { result } = renderHook(() => useProjectTreeState("worktree"));

    act(() => {
      result.current.ensureProjectExpanded(
        "/worktrees/feature",
        "group:/repos/main",
      );
    });

    expect(result.current.expandedProjects).toEqual(
      new Set(["/worktrees/feature", "group:/repos/main"]),
    );
  });
});
