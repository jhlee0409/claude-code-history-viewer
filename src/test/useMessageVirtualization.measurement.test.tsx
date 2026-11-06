import { act, render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import type { ClaudeMessage } from "@/types";

// A browser delivers ResizeObserver after layout, before paint. The transcript
// must consume those measurements before paint, not defer them to the next rAF.
it("covers the viewport with measured rows at the ResizeObserver paint boundary during a wheel scroll", () => {
  const observers: { callback: ResizeObserverCallback; nodes: Set<Element> }[] = [];
  class Observer {
    record: (typeof observers)[number];
    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, nodes: new Set() };
      observers.push(this.record);
    }
    observe(node: Element) { this.record.nodes.add(node); }
    unobserve(node: Element) { this.record.nodes.delete(node); }
    disconnect() { this.record.nodes.clear(); }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  // No animation frame is run between layout observation and the paint assertion.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  const scroller = document.createElement("div");
  document.body.append(scroller);
  Object.defineProperties(scroller, {
    offsetWidth: { value: 1000 }, offsetHeight: { value: 671 },
    clientHeight: { value: 671 }, scrollHeight: { value: 1000000 },
  });
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === "object") scroller.scrollTop = options.top ?? scroller.scrollTop;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0) - scroller.scrollTop;
    return { x: 0, y: top, top, bottom: top + 52, left: 0, right: 1000, width: 1000, height: 52, toJSON() {} };
  });
  const messages = Array.from({ length: 200 }, (_, i) => ({
    uuid: `measurement-${i}`, type: "assistant", timestamp: "2026-06-30T00:00:00Z",
    content: [{ type: "tool_use", id: `tool-${i}`, name: "Read", input: { file_path: "a".repeat(3000) } }],
  })) as ClaudeMessage[];
  const options = {
    messages, agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
    taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
    getScrollElement: () => scroller,
  };
  let current: ReturnType<typeof useMessageVirtualization>;
  function Harness() {
    current = useMessageVirtualization(options);
    return <>{current.virtualRows.map(row => <div key={row.key} ref={current.virtualizer.measureElement} data-index={row.index} style={{ transform: `translateY(${row.start}px)` }} />)}</>;
  }
  render(<Harness />, { container: scroller });
  act(() => {
    scroller.scrollTop = 20000;
    scroller.dispatchEvent(new Event("scroll"));
  });
  const target = current!.virtualizer.range!.startIndex;
  const targetKey = current!.virtualizer.options.getItemKey(target);
  // New rows mount while isScrolling=true, so their initial ref measurement is
  // intentionally skipped by TanStack. The native RO delivery must catch up.
  expect(current!.virtualizer.isScrolling).toBe(true);
  expect(current!.virtualizer.itemSizeCache.has(targetKey)).toBe(false);
  act(() => {
    for (const { callback, nodes } of observers) {
      callback([...nodes].filter(n => n.isConnected).map(node => ({
        target: node, borderBoxSize: [{ inlineSize: 1000, blockSize: node === scroller ? 671 : 52 }],
      } as unknown as ResizeObserverEntry)), {} as ResizeObserver);
    }
  });
  const visibleRows = [...scroller.querySelectorAll("[data-index]")].map(node => node.getBoundingClientRect()).filter(r => r.bottom > 0 && r.top < 671);
  expect(visibleRows.length, "paint must contain actual message rows, not estimated empty space").toBeGreaterThan(0);
  expect(current!.virtualizer.itemSizeCache.get(targetKey)).toBe(52);
  expect(current!.virtualRows.some(row => row.start <= scroller.scrollTop && row.end > scroller.scrollTop)).toBe(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
