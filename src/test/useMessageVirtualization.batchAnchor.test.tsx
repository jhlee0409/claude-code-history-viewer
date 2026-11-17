import { act, cleanup, render } from "@testing-library/react";
import { Virtualizer } from "@tanstack/react-virtual";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import type { ClaudeMessage } from "@/types";

vi.mock("@/components/MessageViewer/helpers/heightEstimation", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/MessageViewer/helpers/heightEstimation")>(),
  estimateMessageHeight: () => 200,
}));

it("keeps an anchor's viewport position when newly mounted rows above it shrink in one scrolling commit", () => {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error");
  // No layout/RO delivery in JSDOM: the real hook's commit measurement must
  // reconcile newly mounted rows while the real core is still scrolling.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const scroller = document.createElement("div");
  document.body.append(scroller);
  Object.defineProperties(scroller, {
    offsetWidth: { value: 800 }, offsetHeight: { value: 400 },
    clientHeight: { value: 400 }, scrollHeight: { value: 100000 },
  });
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === "object") scroller.scrollTop = options.top ?? scroller.scrollTop;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this === scroller ? 400 : 40;
    return { x: 0, y: 0, top: 0, bottom: height, left: 0, right: 800, width: 800, height, toJSON() {} };
  });
  const options = {
    messages: Array.from({ length: 160 }, (_, index) => ({
      uuid: `synthetic-${index}`, type: "user", timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "synthetic row" },
    })) as ClaudeMessage[],
    agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
    taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
    getScrollElement: () => scroller,
  };
  let current: ReturnType<typeof useMessageVirtualization>;
  function Harness() {
    current = useMessageVirtualization(options);
    return <div style={{ height: current.totalSize }}>{current.virtualRows.map(row =>
      <div key={row.key} data-index={row.index} ref={current.virtualizer.measureElement}
        style={{ transform: `translateY(${row.start}px)` }} />
    )}</div>;
  }
  render(<Harness />, { container: scroller });
  const v = current!.virtualizer;
  expect(v).toBeInstanceOf(Virtualizer);
  const anchorIndex = current!.getScrollIndex("synthetic-60")!;
  const anchorKey = v.options.getItemKey(anchorIndex);
  const initialStart = v.getOffsetForIndex(anchorIndex, "start")![0];
  const viewportPosition = 20;
  expect(v.itemSizeCache.has(anchorKey), "anchor must not already be measured").toBe(false);
  act(() => {
    scroller.scrollTop = initialStart - viewportPosition;
    scroller.dispatchEvent(new Event("scroll"));
  });
  expect(v.isScrolling).toBe(true);
  const finalStart = v.getOffsetForIndex(anchorIndex, "start")![0];
  expect(initialStart - finalStart, "multiple preceding rows must actually shrink").toBeGreaterThan(200);
  expect(finalStart - scroller.scrollTop, "height changes above the anchor must not move it on screen").toBeCloseTo(viewportPosition, 6);
  const anchor = current!.virtualRows.find(row => row.key === anchorKey)!;
  expect(anchor, "anchor remains mounted after reconciliation").toBeDefined();
  expect(anchor.size).toBe(40);
  expect(errors).not.toHaveBeenCalled();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
