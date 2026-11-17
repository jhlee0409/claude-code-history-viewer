import { act, render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import type { ClaudeMessage } from "@/types";

// A browser delivers ResizeObserver after layout, before paint. The transcript
// must consume those measurements before paint, not defer them to the next rAF.
it.each([
  ["initial", false], ["initial", true],
  ["layout", false], ["ResizeObserver", false], ["layout", true],
] as const)("covers the entire viewport at the %s boundary (mixed/zero heights=%s)", (boundary, mixed) => {
  const errors = vi.spyOn(console, "error");
  const reads = new Map<HTMLElement, number>();
  const heightOf = (node: HTMLElement) => node.getAttribute("aria-hidden") === "true" ? 0 :
    mixed ? 40 + (Number(node.dataset.index) % 3) * 13 : 52;
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
    reads.set(this, (reads.get(this) ?? 0) + 1);
    const top = Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0) - scroller.scrollTop;
    const height = heightOf(this);
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 1000, width: 1000, height, toJSON() {} };
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
    return <>{current.virtualRows.map(row => <div key={row.key} ref={current.virtualizer.measureElement} data-index={row.index} aria-hidden={mixed && row.index % 7 === 0 ? "true" : undefined} style={{ transform: `translateY(${row.start}px)` }} />)}</>;
  }
  const view = render(<Harness />, { container: scroller });
  if (boundary === "initial") {
    // First committed range must be usable without a scroll, RO delivery, or rAF.
    const boxes = [...scroller.querySelectorAll("[data-index]")]
      .map(node => node.getBoundingClientRect()).filter(box => box.height > 0)
      .sort((a, b) => a.top - b.top);
    expect(boxes.length).toBeGreaterThan(0);
    let end = 0;
    for (const box of boxes) {
      expect(box.top, `initial viewport gap after ${end}`).toBeLessThanOrEqual(end);
      end = Math.max(end, box.bottom);
    }
    expect(end).toBeGreaterThanOrEqual(671);
    expect(errors).not.toHaveBeenCalled();
    return;
  }
  reads.clear();
  act(() => {
    scroller.scrollTop = 20000;
    scroller.dispatchEvent(new Event("scroll"));
  });
  const target = current!.virtualizer.range!.startIndex;
  const targetKey = current!.virtualizer.options.getItemKey(target);
  const targetNode = current!.virtualizer.elementsCache.get(targetKey)! as HTMLElement;
  // TanStack skips new ref measurements while scrolling. Layout must reconcile
  // tall estimates to short real rows, including mounts caused by that change.
  expect(current!.virtualizer.isScrolling).toBe(true);
  if (boundary === "layout") {
    expect([...reads.values()].every(count => count === 1), "one layout read per newly mounted node, not per render").toBe(true);
  }
  if (boundary === "ResizeObserver") act(() => {
    for (const { callback, nodes } of observers) {
      callback([...nodes].filter(n => n.isConnected).map(node => ({
        target: node, borderBoxSize: [{ inlineSize: 1000, blockSize: node === scroller ? 671 : 52 }],
      } as unknown as ResizeObserverEntry)), {} as ResizeObserver);
    }
  });
  const visibleRows = [...scroller.querySelectorAll("[data-index]")].map(node => node.getBoundingClientRect()).filter(r => r.bottom > 0 && r.top < 671);
  expect(visibleRows.length, "paint must contain actual message rows, not estimated empty space").toBeGreaterThan(0);
  let coveredUntil = 0;
  for (const row of visibleRows.sort((a, b) => a.top - b.top)) {
    expect(row.top, `uncovered viewport after y=${coveredUntil}`).toBeLessThanOrEqual(coveredUntil);
    coveredUntil = Math.max(coveredUntil, row.bottom);
  }
  expect(coveredUntil, "real row boxes must cover the viewport before another rAF").toBeGreaterThanOrEqual(671);
  expect(current!.virtualizer.itemSizeCache.get(targetKey)).toBe(heightOf(targetNode));
  expect(current!.virtualRows.some(row => row.start <= scroller.scrollTop && row.end > scroller.scrollTop)).toBe(true);
  const readCount = [...reads.values()].reduce((a, b) => a + b, 0);
  view.rerender(<Harness />);
  view.rerender(<Harness />);
  expect([...reads.values()].reduce((a, b) => a + b, 0), "unchanged mounted rows must not remeasure on render").toBe(readCount);

  // A still-connected stale node must not measure the new occupant of its
  // index after a reorder/prepend. The cache key must match the current index.
  const originalIndex = targetNode.dataset.index!;
  targetNode.dataset.index = String(current!.flattenedMessages.length + 1);
  view.rerender(<Harness />);
  expect([...reads.values()].reduce((a, b) => a + b, 0)).toBe(readCount);
  targetNode.dataset.index = originalIndex;
  // Same hook instance survives prepends and a new session/key space.
  options.messages = [{ ...messages[0], uuid: "prepended" } as ClaudeMessage, ...messages];
  view.rerender(<Harness />);
  options.messages = messages.map(message => ({ ...message, uuid: `session-2:${message.uuid}` }));
  view.rerender(<Harness />);
  expect(current!.virtualRows.every(row => current!.virtualizer.options.getItemKey(row.index) === row.key)).toBe(true);
  expect(errors, "no reentrant flushSync or update-depth errors").not.toHaveBeenCalled();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
