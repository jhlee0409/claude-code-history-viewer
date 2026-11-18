import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "../../../types";
import { hasStepTarget, stepInTurn } from "@/commands/stepTarget";
import type { FlattenedMessage } from "../types";
import { useStepNavigation } from "./useStepNavigation";

const message = (uuid: string, type: "user" | "assistant"): ClaudeMessage =>
  ({
    uuid,
    type,
    sessionId: "s",
    timestamp: "2026-11-18T10:00:00Z",
    content: type === "user" ? `Prompt ${uuid}` : [{ type: "text", text: `Reply ${uuid}` }],
  }) as unknown as ClaudeMessage;

// p1: a1 a2 a3 | p2: b1 - 100px rows.
const messages = [
  message("p1", "user"),
  message("a1", "assistant"),
  message("a2", "assistant"),
  message("a3", "assistant"),
  message("p2", "user"),
  message("b1", "assistant"),
];
const rows: FlattenedMessage[] = messages.map((msg) => ({
  type: "message",
  message: msg,
  depth: 0,
  originalIndex: 0,
  isGroupLeader: false,
  isGroupMember: false,
  isProgressGroupLeader: false,
  isProgressGroupMember: false,
  isTaskOperationGroupLeader: false,
  isTaskOperationGroupMember: false,
  isContinuation: false,
}));

/** A virtualizer that has rendered only rows `from`..`to` (overscan included). */
const virtualizerRendering = (from: number, to: number) =>
  ({
    getVirtualItems: () =>
      rows.slice(from, to + 1).map((_, offset) => ({ index: from + offset, start: (from + offset) * 100, size: 100 })),
  }) as unknown as Virtualizer<HTMLElement, Element>;

const setup = (scrollTop: number, targetMessageUuid: string | null = null, virtualizer = virtualizerRendering(0, 5)) => {
  const navigateToMessage = vi.fn();
  const viewport = { scrollTop } as unknown as HTMLElement;
  const hook = renderHook(() =>
    useStepNavigation({
      messages,
      flattenedMessages: rows,
      virtualizer,
      getScrollElement: () => viewport,
      targetMessageUuid,
      navigateToMessage,
      isInSubagent: false,
    }),
  );
  return { navigateToMessage, hook };
};

describe("useStepNavigation", () => {
  it("answers the step commands while mounted, and stops when unmounted", () => {
    const { navigateToMessage, hook } = setup(100);
    expect(hasStepTarget()).toBe(true);

    expect(stepInTurn("next")).toBe(true);
    expect(navigateToMessage).toHaveBeenLastCalledWith("a2", { history: "replace" });

    hook.unmount();
    expect(hasStepTarget()).toBe(false);
    expect(stepInTurn("next")).toBe(false);
  });

  it("steps back within the turn and stops at its first step", () => {
    const { navigateToMessage, hook } = setup(200);
    expect(stepInTurn("previous")).toBe(true);
    expect(navigateToMessage).toHaveBeenLastCalledWith("a1", { history: "replace" });
    hook.unmount();

    const first = setup(100);
    expect(stepInTurn("previous")).toBe(false);
    expect(first.navigateToMessage).not.toHaveBeenCalled();
    first.hook.unmount();
  });

  it("does not cross into the next turn", () => {
    const { navigateToMessage, hook } = setup(300);
    expect(stepInTurn("next")).toBe(false);
    expect(navigateToMessage).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("steps on from a jump still scrolling to a row the list has not rendered yet", () => {
    // The list still shows rows 0-1; a previous step targeted a2 (row 2).
    const { navigateToMessage, hook } = setup(0, "a2", virtualizerRendering(0, 1));
    expect(stepInTurn("next")).toBe(true);
    expect(navigateToMessage).toHaveBeenLastCalledWith("a3", { history: "replace" });
    hook.unmount();
  });

  it("steps from the row in view of a far scroll position when only that window is rendered", () => {
    const { navigateToMessage, hook } = setup(400, null, virtualizerRendering(3, 5));
    expect(stepInTurn("next")).toBe(true);
    expect(navigateToMessage).toHaveBeenLastCalledWith("b1", { history: "replace" });
    hook.unmount();
  });

  it("keeps the newer registration when an older list unmounts", () => {
    const older = setup(100);
    const newer = setup(100);
    older.hook.unmount();
    expect(stepInTurn("next")).toBe(true);
    expect(newer.navigateToMessage).toHaveBeenCalledWith("a2", { history: "replace" });
    expect(older.navigateToMessage).not.toHaveBeenCalled();
    newer.hook.unmount();
  });
});
