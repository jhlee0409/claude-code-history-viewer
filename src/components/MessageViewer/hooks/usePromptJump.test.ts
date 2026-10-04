import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "../../../types";
import type { FlattenedMessage } from "../types";
import { usePromptJump } from "./usePromptJump";

const messageRow = (uuid: string, type: "user" | "assistant"): FlattenedMessage => ({
  type: "message",
  message: {
    uuid,
    type,
    role: type,
    timestamp: "2026-10-04T10:00:00Z",
    content: type === "user" ? `Prompt ${uuid}` : [{ type: "text", text: `Reply ${uuid}` }],
  } as unknown as ClaudeMessage,
  depth: 0,
  originalIndex: 0,
  isGroupLeader: false,
  isGroupMember: false,
  isProgressGroupLeader: false,
  isProgressGroupMember: false,
  isTaskOperationGroupLeader: false,
  isTaskOperationGroupMember: false,
  isContinuation: false,
});

// Five rows, 100px each: p1 0-100, r1 100-200, p2 200-300, r2 300-400, p3 400-500.
const rows: FlattenedMessage[] = [
  messageRow("p1", "user"),
  messageRow("r1", "assistant"),
  messageRow("p2", "user"),
  messageRow("r2", "assistant"),
  messageRow("p3", "user"),
];
const virtualizer = {
  getVirtualItems: () => rows.map((_, index) => ({ index, start: index * 100, size: 100 })),
} as unknown as Virtualizer<HTMLElement, Element>;

const setup = (scrollTop: number, targetMessageUuid: string | null = null) => {
  const navigateToMessage = vi.fn();
  const viewport = { scrollTop } as unknown as HTMLElement;
  const hook = renderHook(() =>
    usePromptJump({
      flattenedMessages: rows,
      virtualizer,
      getScrollElement: () => viewport,
      targetMessageUuid,
      navigateToMessage,
    }),
  );
  return { navigateToMessage, hook };
};

const press = (key: string, modifiers: KeyboardEventInit = { altKey: true }, target: EventTarget = window) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
};

describe("usePromptJump", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("jumps to the next prompt with Alt+ArrowDown without adding history", () => {
    const { navigateToMessage } = setup(250);
    const event = press("ArrowDown");
    expect(navigateToMessage).toHaveBeenCalledWith("p3", { history: "replace" });
    expect(event.defaultPrevented).toBe(true);
  });

  it("jumps back to the start of the turn in view with Alt+ArrowUp", () => {
    const { navigateToMessage } = setup(320);
    press("ArrowUp");
    expect(navigateToMessage).toHaveBeenCalledWith("p2", { history: "replace" });
  });

  it("treats a row ending within a pixel or two of the top as scrolled past", () => {
    // After a jump the target sits at the top, give or take subpixel rounding.
    const { navigateToMessage } = setup(199.5);
    press("ArrowDown");
    expect(navigateToMessage).toHaveBeenCalledWith("p3", { history: "replace" });
  });

  it("steps from a jump that is still scrolling, not from the old viewport", () => {
    const { navigateToMessage } = setup(0, "p2");
    press("ArrowDown");
    expect(navigateToMessage).toHaveBeenCalledWith("p3", { history: "replace" });
  });

  it("ignores the keys while focus is in a text field", () => {
    const { navigateToMessage } = setup(250);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = press("ArrowDown", { altKey: true }, input);
    expect(navigateToMessage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores other modifier combinations", () => {
    const { navigateToMessage } = setup(250);
    press("ArrowDown", { altKey: true, ctrlKey: true });
    press("ArrowDown", { altKey: true, shiftKey: true });
    press("ArrowDown", { altKey: true, metaKey: true });
    press("ArrowDown", {});
    expect(navigateToMessage).not.toHaveBeenCalled();
  });

  it("does nothing past the last loaded prompt", () => {
    const { navigateToMessage } = setup(450);
    const event = press("ArrowDown");
    expect(navigateToMessage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { navigateToMessage, hook } = setup(250);
    hook.unmount();
    press("ArrowDown");
    expect(navigateToMessage).not.toHaveBeenCalled();
  });
});
