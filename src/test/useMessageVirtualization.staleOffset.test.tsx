import { act, cleanup, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import type { ClaudeMessage } from "@/types";

vi.mock("@/components/MessageViewer/helpers/heightEstimation", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/MessageViewer/helpers/heightEstimation")>(),
  estimateMessageHeight: () => 200,
}));

const rows = (prefix: string, length: number) => Array.from({ length }, (_, index) => ({
  uuid: `${prefix}-${index}`, type: "user", timestamp: "2026-01-01T00:00:00Z",
  message: { role: "user", content: "synthetic row" },
})) as ClaudeMessage[];

/** Rows estimate 200px and measure 40px; scrolled to the top, still scrolling. */
function scrolledToTop() {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const scroller = document.createElement("div");
  document.body.append(scroller);
  Object.defineProperties(scroller, {
    offsetWidth: { value: 800 }, offsetHeight: { value: 400 },
    clientHeight: { value: 400 }, scrollHeight: { value: 1000000 },
  });
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === "object") scroller.scrollTop = options.top ?? scroller.scrollTop;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this === scroller ? 400 : 40;
    return { x: 0, y: 0, top: 0, bottom: height, left: 0, right: 800, width: 800, height, toJSON() {} };
  });
  const options = {
    messages: rows("window", 160),
    agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
    taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
    getScrollElement: () => scroller,
  };
  const state: {
    current?: ReturnType<typeof useMessageVirtualization>;
    restore: { uuid: string; screenOffset: number } | null;
  } = { restore: null };
  const startOf = (uuid: string) =>
    state.current!.virtualizer.getOffsetForIndex(state.current!.getScrollIndex(uuid)!, "start")![0];
  function Harness() {
    const current = state.current = useMessageVirtualization(options);
    // Same shape as MessageViewer's prepend restore: a direct scrollTop write
    // in a layout effect that runs after the hook's own.
    useLayoutEffect(() => {
      const anchor = state.restore;
      if (!anchor) return;
      state.restore = null;
      scroller.scrollTop = startOf(anchor.uuid) - anchor.screenOffset;
    });
    return <div style={{ height: current.totalSize }}>{current.virtualRows.map(row =>
      <div key={row.key} data-index={row.index} ref={current.virtualizer.measureElement}
        style={{ transform: `translateY(${row.start}px)` }} />
    )}</div>;
  }
  const view = render(<Harness />, { container: scroller });
  // Reach the top by scrolling, as the near-top autoload does.
  for (const top of [600, 0]) {
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll"));
    });
  }
  expect(state.current!.virtualizer.isScrolling).toBe(true);
  return {
    scroller, options, state,
    rerender: () => view.rerender(<Harness />),
    screenOffsetOf: (uuid: string) => startOf(uuid) - scroller.scrollTop,
    isMounted: (uuid: string) => state.current!.virtualRows.some(row => row.key === uuid),
  };
}

// MessageViewer restores a prepended page by writing scrollTop directly in a
// layout effect after this hook's; core sees that offset only at the next
// scroll event. Measuring the pre-restore range re-renders it, and the rows
// that render newly mounts are measured against the stale offset: their size
// deltas go uncompensated and push the restored row off screen.
it("keeps a restored prepend anchor in place until core observes the restore scroll", () => {
  const errors = vi.spyOn(console, "error");
  const view = scrolledToTop();
  const anchor = "window-0";
  const screenOffset = view.screenOffsetOf(anchor);

  act(() => {
    view.state.restore = { uuid: anchor, screenOffset };
    view.options.messages = [...rows("older", 100), ...view.options.messages];
    view.rerender();
  });
  expect(view.scroller.scrollTop, "the restore moved the viewport").toBeGreaterThan(1000);
  expect(view.screenOffsetOf(anchor), "rows of the pre-restore range must not move the anchor").toBeCloseTo(screenOffset, 6);
  expect(view.state.current!.virtualizer.itemSizeCache.has("older-0"), "the pre-restore range is not measured").toBe(false);

  act(() => {
    view.scroller.dispatchEvent(new Event("scroll"));
  });
  expect(view.isMounted(anchor), "anchor mounts at the restored offset").toBe(true);
  expect(view.screenOffsetOf(anchor), "rows mounted at the restored offset keep the anchor").toBeCloseTo(screenOffset, 6);
  expect(errors).not.toHaveBeenCalled();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
