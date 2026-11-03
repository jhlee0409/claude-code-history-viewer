import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollNavigation } from "@/components/MessageViewer/hooks/useScrollNavigation";

const initialUuids = Array.from({ length: 200 }, (_, i) => `uuid-${i + 1}`);
const latestUuids = [...initialUuids.slice(1), "uuid-201"];

function mount() {
  const viewport = document.createElement("div");
  Object.defineProperties(viewport, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 500 },
  });
  viewport.scrollTop = 1500;
  const scrollToIndex = vi.fn();
  const virtualizer = { scrollToIndex } as unknown as Virtualizer<HTMLElement, Element>;
  const scrollContainerRef = {
    current: { osInstance: () => ({ elements: () => ({ viewport }) }) },
  } as unknown as RefObject<OverlayScrollbarsComponentRef | null>;
  const defaults = {
    messageUuids: initialUuids,
    messageUpdateKind: "tail-refresh" as "replace" | "prepend" | "tail-refresh",
    messagesLength: 124,
    selectedSessionId: "session-a",
    targetMessageUuid: null as string | null,
  };
  const hook = renderHook((props: typeof defaults) => useScrollNavigation({
    ...props,
    scrollContainerRef,
    currentMatchUuid: null,
    currentMatchIndex: -1,
    isLoading: false,
    virtualizer,
    scrollElementReady: true,
  }), { initialProps: defaults });
  act(() => vi.advanceTimersByTime(500));
  scrollToIndex.mockClear();
  return {
    ...hook, viewport, scrollToIndex,
    update: (props: Partial<typeof defaults>) => {
      hook.rerender({ ...defaults, ...props });
      act(() => vi.advanceTimersByTime(500));
    },
  };
}

describe("useScrollNavigation — source tail vs prepend", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([125, 124, 123])(
    "follows a bounded latest-200 replacement with changed head and %i rendered rows",
    (messagesLength) => {
      const h = mount();
      // Normalization/filtering may change source count as well as row count.
      const messageUuids = messagesLength === 125
        ? [...latestUuids, "uuid-202"]
        : messagesLength === 123 ? latestUuids.slice(1) : latestUuids;
      h.update({ messageUuids, messagesLength });
      expect(h.scrollToIndex).toHaveBeenCalledWith(messagesLength - 1, { align: "end" });
    },
  );

  it("retains the viewport on a true older-page prepend", () => {
    const h = mount();
    h.viewport.scrollTop = 1450; // still near bottom: suppression must be semantic
    h.update({ messageUuids: ["older-1", "older-2", ...initialUuids], messagesLength: 126, messageUpdateKind: "prepend" });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
    expect(h.viewport.scrollTop).toBe(1450);
  });

  it("does not follow when the user has scrolled away from the bottom", () => {
    const h = mount();
    act(() => {
      h.viewport.scrollTop = 500;
      h.viewport.dispatchEvent(new Event("scroll"));
    });
    h.update({ messageUuids: latestUuids, messagesLength: 125 });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
    expect(h.viewport.scrollTop).toBe(500);
  });

  it("leaves a target jump in charge and does not replay the skipped append", () => {
    const h = mount();
    h.update({ messageUuids: latestUuids, messagesLength: 125, targetMessageUuid: "uuid-50" });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
    h.update({ messageUuids: latestUuids, messagesLength: 125 });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
  });

  it("does not treat filtering or regrouping rendered rows as source appends", () => {
    const h = mount();
    for (const messagesLength of [140, 80, 124]) {
      h.update({ messageUuids: [...initialUuids], messagesLength });
      expect(h.scrollToIndex).not.toHaveBeenCalled();
    }
  });

  it("does not follow tail deletion or source reordering", () => {
    const h = mount();
    h.update({ messageUuids: initialUuids.slice(0, -1), messagesLength: 125 });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
    h.update({ messageUuids: [...initialUuids.slice(0, -2), "uuid-200", "uuid-199"], messagesLength: 126 });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
  });

  it("does not mistake a filter reload revealing an existing suffix for new writes", () => {
    const h = mount();
    h.update({ messageUuids: [...initialUuids, "previously-filtered"], messagesLength: 125, messageUpdateKind: "replace" });
    expect(h.scrollToIndex).not.toHaveBeenCalled();
    h.update({ messageUuids: [...initialUuids, "previously-filtered", "new-write"], messagesLength: 126 });
    expect(h.scrollToIndex).toHaveBeenCalledWith(125, { align: "end" });
  });

  it("initializes a new session independently of the old tail", () => {
    const h = mount();
    h.update({ selectedSessionId: "session-b", messageUuids: latestUuids, messagesLength: 125 });
    expect(h.result.current.scrollReadyForSessionId).toBe("session-b");
    expect(h.scrollToIndex).toHaveBeenCalledWith(124, { align: "end" });
  });

  it("keeps a restored target on session switch instead of following the old tail", () => {
    const h = mount();
    h.update({ selectedSessionId: "session-b", messageUuids: latestUuids, messagesLength: 125, targetMessageUuid: "uuid-50" });
    expect(h.result.current.scrollReadyForSessionId).toBe("session-b");
    expect(h.scrollToIndex).not.toHaveBeenCalled();
  });
});
