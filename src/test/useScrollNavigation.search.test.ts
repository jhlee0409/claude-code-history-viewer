import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useScrollNavigation } from "@/components/MessageViewer/hooks/useScrollNavigation";

// Builds a fake OverlayScrollbars ref whose viewport is a real DOM node we
// control, so getScrollViewport() resolves to it.
function makeScrollRef(
  viewport: HTMLElement
): RefObject<OverlayScrollbarsComponentRef | null> {
  return {
    current: {
      osInstance: () => ({
        elements: () => ({ viewport }),
      }),
    },
  } as unknown as RefObject<OverlayScrollbarsComponentRef | null>;
}

function makeVirtualizer(scrollToIndex: Mock): Virtualizer<HTMLElement, Element> {
  return { scrollToIndex } as unknown as Virtualizer<HTMLElement, Element>;
}

// A message container with an active-highlight <mark> inside it, mirroring the
// real DOM: [data-message-uuid] wraps the highlighted text.
function makeMessageWithHighlight(uuid: string): {
  message: HTMLElement;
  markScrollIntoView: Mock;
} {
  const message = document.createElement("div");
  message.setAttribute("data-message-uuid", uuid);
  const mark = document.createElement("mark");
  mark.setAttribute("data-search-highlight", "current");
  const markScrollIntoView = vi.fn();
  mark.scrollIntoView = markScrollIntoView;
  message.appendChild(mark);
  return { message, markScrollIntoView };
}

describe("useScrollNavigation — search scroll (#429)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("scrolls straight to the active highlight without a message-level jump when it is already rendered", () => {
    const viewport = document.createElement("div");
    const { message, markScrollIntoView } = makeMessageWithHighlight("msg-1");
    viewport.appendChild(message);

    const scrollToIndex = vi.fn();

    renderHook(() =>
      useScrollNavigation({
        scrollContainerRef: makeScrollRef(viewport),
        currentMatchUuid: "msg-1",
        currentMatchIndex: 2,
        messagesLength: 10,
        isLoading: false,
        virtualizer: makeVirtualizer(scrollToIndex),
        getScrollIndex: () => 5,
        scrollElementReady: false, // disables the unrelated scroll-to-bottom effect
      })
    );

    vi.runAllTimers();

    // The whole point of the fix: no double-jump. We go directly to the
    // occurrence and never ask the virtualizer to bring the message into view.
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(markScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("falls back to the virtualizer when the target highlight is not yet rendered", () => {
    const viewport = document.createElement("div"); // no highlight inside
    const scrollToIndex = vi.fn();

    renderHook(() =>
      useScrollNavigation({
        scrollContainerRef: makeScrollRef(viewport),
        currentMatchUuid: "msg-2",
        currentMatchIndex: 0,
        messagesLength: 10,
        isLoading: false,
        virtualizer: makeVirtualizer(scrollToIndex),
        getScrollIndex: () => 7,
        scrollElementReady: false,
      })
    );

    vi.runAllTimers();

    expect(scrollToIndex).toHaveBeenCalledWith(7, { align: "center" });
  });

  it("does not let another message's highlight hijack the scroll (scopes to matchUuid)", () => {
    // A `current` highlight exists, but it belongs to a DIFFERENT message than
    // the one we're navigating to (e.g. a deep-link target rendered alongside).
    const viewport = document.createElement("div");
    const { message: foreign, markScrollIntoView: foreignScroll } =
      makeMessageWithHighlight("other-msg");
    viewport.appendChild(foreign);

    const scrollToIndex = vi.fn();

    renderHook(() =>
      useScrollNavigation({
        scrollContainerRef: makeScrollRef(viewport),
        currentMatchUuid: "msg-2", // target is NOT the message holding the mark
        currentMatchIndex: 0,
        messagesLength: 10,
        isLoading: false,
        virtualizer: makeVirtualizer(scrollToIndex),
        getScrollIndex: () => 7,
        scrollElementReady: false,
      })
    );

    vi.runAllTimers();

    // Must ignore the foreign highlight and use the virtualizer for the target.
    expect(foreignScroll).not.toHaveBeenCalled();
    expect(scrollToIndex).toHaveBeenCalledWith(7, { align: "center" });
  });
});
