import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import type { ClaudeMessage } from "@/types";
import { useState } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function fixture(quantize = false, boundary = false) {
  const notifications = vi.spyOn(toast, "error");
  const errors = vi.spyOn(console, "error");
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  const scroller = document.createElement("div");
  scroller.style.lineHeight = "20px";
  document.body.append(scroller);
  Object.defineProperties(scroller, {
    offsetWidth: { value: 1000 }, offsetHeight: { value: 671 },
    clientHeight: { value: 671 }, scrollHeight: { configurable: true, get: () => current?.totalSize ?? 100000 },
  });
  const heightOf = (node: HTMLElement) => node.getAttribute("aria-hidden") === "true" ? 0 : 40 + Number(node.dataset.index) % 3 * 13;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this === scroller ? 0 : Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0) - scroller.scrollTop;
    const height = this === scroller ? 671 : heightOf(this);
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 1000, width: 1000, height, toJSON() {} };
  });
  const covered = (offset: number) => {
    let end = offset;
    const boxes = [...scroller.querySelectorAll<HTMLElement>("[data-index]")].map(node => {
      const box = node.getBoundingClientRect();
      return { top: box.top + scroller.scrollTop, bottom: box.bottom + scroller.scrollTop };
    }).filter(box => box.bottom > offset).sort((a, b) => a.top - b.top);
    for (const box of boxes) {
      if (box.top > end + 0.01) break;
      end = Math.max(end, box.bottom);
    }
    return end >= offset + 671;
  };
  const releases: { offset: number; coverageBeforeRelease: boolean }[] = [];
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options !== "object") return;
    const offset = options.top ?? scroller.scrollTop;
    releases.push({ offset, coverageBeforeRelease: covered(offset) });
    scroller.scrollTop = quantize ? Math.round(offset) : offset;
  });
  const messages = Array.from({ length: 500 }, (_, i) => ({
    uuid: `wheel-${i}`, type: "assistant", timestamp: "2026-06-30T00:00:00Z",
    content: [{ type: "tool_use", id: `tool-${i}`, name: "Read", input: { file_path: "a".repeat(3000) } }],
  })) as ClaudeMessage[];
  let source: HTMLElement | null = scroller;
  let duringCommit: (() => void) | undefined;
  let renderError: Error | undefined;
  const options = {
    messages, agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(),
    taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
    getScrollElement: () => source,

  };
  let current: ReturnType<typeof useMessageVirtualization>;
  let replaceMessages: (append: boolean) => void;
  function Harness() {
    const [liveMessages, setMessages] = useState(messages);
    replaceMessages = append => setMessages(previous => append
      ? [...previous, { ...previous[0]!, uuid: "stream-append" }] : [...previous]);
    current = useMessageVirtualization({ ...options, messages: liveMessages });
    if (renderError && current.virtualizer.isScrolling) throw renderError;
    return <>{current.virtualRows.map(row => <div key={row.key} ref={node => {
      current.virtualizer.measureElement(node);
      if (node && current.virtualizer.isScrolling && duringCommit) {
        const action = duringCommit;
        duringCommit = undefined;
        action();
      }
    }} data-index={row.index} aria-hidden={row.index % 7 === 0 ? "true" : undefined} style={{ transform: `translateY(${row.start}px)` }} />)}</>;
  }
  const view = render(boundary ? <ErrorBoundary><Harness /></ErrorBoundary> : <Harness />, { container: scroller });
  releases.length = 0;
  const wheel = (init: WheelEventInit = {}, target: HTMLElement = scroller, native = false) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 3795.779541015625, ...init });
    if (native) target.dispatchEvent(event);
    else act(() => { target.dispatchEvent(event); });
    return event;
  };
  return { scroller, wheel, releases, covered, errors, notifications, view, current: () => current!,
    setSource: (element: HTMLElement | null) => { source = element; },
    duringCommit: (action: () => void) => { duringCommit = action; },
    throwDuringRender: (error: Error) => { renderError = error; },
    replaceMessages: (append: boolean) => replaceMessages(append),
  };
}

it("commits actual destination coverage before releasing an owned wheel beyond old overscan", () => {
  const f = fixture();
  expect(Math.max(...f.current().virtualRows.map(row => row.end))).toBeLessThan(3795);
  const event = f.wheel();
  // JSDOM has no native wheel default: model its physical advancement only
  // when product code did not cancel it. The oracle remains actual DOM boxes.
  if (!event.defaultPrevented) f.scroller.scrollTo({ top: 3795.779541015625 });
  expect(f.releases.every(release => release.coverageBeforeRelease), "coverageBeforeRelease (including native default)").toBe(true);
  expect(event.defaultPrevented, "the transcript must own this cancelable vertical wheel").toBe(true);
  expect(f.releases.length).toBeGreaterThan(0);
  expect(f.releases.every(release => release.coverageBeforeRelease), "all physical writes need already committed real box coverage").toBe(true);
  expect(f.covered(f.scroller.scrollTop)).toBe(true);
  expect(f.current().virtualRows.length).toBeLessThan(100);
});

it("leaves a nested vertical scroll consumer's wheel native", () => {
  const f = fixture();
  const nested = document.createElement("div");
  nested.style.overflowY = "auto";
  Object.defineProperties(nested, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } });
  f.scroller.append(nested);
  expect(f.wheel({}, nested).defaultPrevented).toBe(false);
  expect(f.releases).toEqual([]);
});

it("accumulates high-resolution deltas without physical offset rounding drift", () => {
  const f = fixture(true);
  for (let i = 0; i < 20; i++) f.wheel({ deltaY: 0.25, altKey: true, metaKey: true });
  expect(f.releases[f.releases.length - 1]?.offset).toBeCloseTo(5, 8);
  expect(f.scroller.scrollTop).toBe(5);
});

it.each([
  { ctrlKey: true }, { shiftKey: true }, { deltaX: 1 }, { deltaY: 0 },
  { cancelable: false }, { deltaY: -1 },
])("does not own incompatible input %j", init => {
  const f = fixture();
  expect(f.wheel(init).defaultPrevented).toBe(false);
  expect(f.releases).toEqual([]);
});

it.each([[1, 0.5, 10], [2, 0.25, 167.75], [0, 0.125, 0.125]])("normalizes deltaMode %s without integer rounding", (deltaMode, deltaY, expected) => {
  const f = fixture();
  expect(f.wheel({ deltaMode, deltaY }).defaultPrevented).toBe(true);
  expect(f.releases[f.releases.length - 1].offset).toBeCloseTo(expected, 8);
});

it("keeps keyboard, direct scrolling and message jumps on their original paths", () => {
  const f = fixture();
  const key = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
  act(() => { f.scroller.dispatchEvent(key); });
  expect(key.defaultPrevented).toBe(false);
  expect(f.releases).toEqual([]);
  act(() => { f.scroller.scrollTop = 2000; f.scroller.dispatchEvent(new Event("scroll")); });
  expect(f.current().virtualizer.scrollOffset).not.toBe(0);
  const scrollToIndex = vi.spyOn(f.current().virtualizer, "scrollToIndex");
  act(() => { f.current().scrollToMessage("wheel-100"); });
  expect(scrollToIndex).toHaveBeenCalledWith(f.current().getScrollIndex("wheel-100"), { align: "center" });
  expect(f.errors).not.toHaveBeenCalled();
});

it("bounds physical releases and real scroll events under repeated reversals while retaining anchor corrections", () => {
  const f = fixture();
  let scrollEvents = 0;
  f.scroller.addEventListener("scroll", () => { scrollEvents++; });
  let correctedInputs = 0;
  let ownedInputs = 0;
  const inputs = [3795.779541015625, -700, 2100, -900, 2500, -1700, 1900, -800];
  for (const deltaY of inputs) {
    const before = f.scroller.scrollTop;
    if (f.wheel({ deltaY }).defaultPrevented) ownedInputs++;
    if (Math.abs(f.scroller.scrollTop - (before + deltaY)) > 1) correctedInputs++;
    act(() => { f.scroller.dispatchEvent(new Event("scroll")); });
    expect(f.covered(f.scroller.scrollTop)).toBe(true);
  }
  expect(correctedInputs, "core's intentional estimate-to-real anchor policy remains active").toBeGreaterThan(0);
  expect(f.releases.length).toBe(ownedInputs);
  expect(scrollEvents).toBe(inputs.length);
  expect(f.releases.every(release => release.coverageBeforeRelease)).toBe(true);
  expect(f.errors).not.toHaveBeenCalled();
  console.info("wheel transaction events", { inputs: inputs.length, ownedInputs, physicalReleases: f.releases.length, scrollEvents, correctedInputs });
});

it("cancels an eligible reentrant wheel without a second transaction", () => {
  const f = fixture();
  const original = f.scroller.scrollTo;
  let nested: WheelEvent | undefined;
  f.scroller.scrollTo = options => {
    nested = new WheelEvent("wheel", { deltaY: 100, cancelable: true, bubbles: true });
    f.scroller.dispatchEvent(nested);
    original(options);
  };
  f.wheel();
  expect(nested?.defaultPrevented).toBe(true);
  expect(f.releases.length).toBe(1);
});

it("leaves enabled keyboard and programmatic/store-style jumps outside wheel ownership", () => {
  const f = fixture();
  const event = new KeyboardEvent("keydown", { key: "PageDown", cancelable: true, bubbles: true });
  act(() => { f.scroller.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(f.releases).toEqual([]);
  act(() => { f.current().virtualizer.scrollToOffset(5000); });
  expect(f.releases[0].offset).toBe(5000);
  // Deliberately not certified coverage: non-wheel commands stay unmodified.
  expect(f.releases[0].coverageBeforeRelease).toBe(false);
});

it("preserves outside wheels, prior preventDefault and bottom-edge chaining", () => {
  const f = fixture();
  expect(f.wheel({}, document.body).defaultPrevented).toBe(false);
  const event = new WheelEvent("wheel", { deltaY: 500, cancelable: true, bubbles: true });
  event.preventDefault();
  act(() => { f.scroller.dispatchEvent(event); });
  expect(f.releases).toEqual([]);
  act(() => { f.scroller.scrollTop = f.scroller.scrollHeight - 671; f.scroller.dispatchEvent(new Event("scroll")); });
  f.releases.length = 0;
  expect(f.wheel().defaultPrevented).toBe(false);
  expect(f.releases).toEqual([]);
});

it("fails closed if committed actual boxes cannot acknowledge destination coverage", () => {
  const f = fixture();
  const original = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = original.call(this);
    return this === f.scroller ? box : { ...box, top: box.top + 10000, bottom: box.bottom + 10000 };
  });
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.releases).toEqual([]);
  expect(f.scroller.scrollTop).toBe(0);
  expect(f.errors).not.toHaveBeenCalled();
});

it("probe B: observer teardown during the flush commit never restores through a disposed observer", () => {
  const f = fixture();
  const uncaught: unknown[] = [];
  const handle = (event: ErrorEvent) => { uncaught.push(event.error); event.preventDefault(); };
  window.addEventListener("error", handle);
  try {
    const original = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
    f.duringCommit(() => {
      f.setSource(null);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const box = original.call(this);
        return this === f.scroller ? box : { ...box, top: box.top + 10000, bottom: box.bottom + 10000 };
      });
    });
    const event = f.wheel();
    expect(uncaught).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(f.current().virtualizer.scrollElement).toBeNull();
    expect(f.scroller.scrollTop).toBe(0);
    expect(f.releases).toEqual([]);
    expect(f.notifications).not.toHaveBeenCalled();
  } finally { window.removeEventListener("error", handle); }
});

it("probe A: preserves the original uncaught render error without duplicate wheel notification", () => {
  const f = fixture();
  f.errors.mockImplementation(() => {});
  const boom = new Error("probe-row-boom");
  f.throwDuringRender(boom);
  const uncaught: unknown[] = [];
  const handle = (event: ErrorEvent) => { uncaught.push(event.error); event.preventDefault(); };
  window.addEventListener("error", handle);
  try {
    expect(() => f.wheel({}, f.scroller, true)).not.toThrow();
    // React propagates its original render exception once; the wheel listener
    // must not add a second teardown/restore exception.
    expect(uncaught).toEqual([boom]);
    expect(f.scroller.scrollTop).toBe(0);
    expect(f.releases).toEqual([]);
    expect(f.notifications).not.toHaveBeenCalled();
    expect(f.errors.mock.calls.some(args => args.includes(boom))).toBe(true);
    // The failed tree cannot reconcile native scrolls; detached logical state
    // is not reused or written into a replacement owner.
    expect(f.current().virtualizer.scrollElement).toBeNull();
    expect(f.wheel({ ctrlKey: true }).defaultPrevented).toBe(false);
  } finally { window.removeEventListener("error", handle); }
});

it.each([false, true])("silently cancels normal messages owner replacement (stream append=%s)", append => {
  const f = fixture();
  const previous = f.current().flattenedMessages.length;
  f.duringCommit(() => f.replaceMessages(append));
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.current().flattenedMessages.length).toBe(previous + (append ? 1 : 0));
  expect(f.releases).toEqual([]);
  expect(f.scroller.scrollTop).toBe(0);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(f.notifications).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it("does not turn another viewer's normal streaming cancellation into a global failure", () => {
  const first = fixture();
  const second = fixture();
  first.duringCommit(() => first.replaceMessages(true));
  expect(first.wheel().defaultPrevented).toBe(true);
  expect(first.releases).toEqual([]);
  expect(second.releases).toEqual([]);
  expect(first.notifications).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  first.view.unmount();
  expect(second.notifications).not.toHaveBeenCalled();
});

it("leaves actual render-crash feedback to the existing localized ErrorBoundary exactly once", () => {
  const f = fixture(false, true);
  f.errors.mockImplementation(() => {});
  const boom = new Error("boundary-original-row-boom");
  f.throwDuringRender(boom);
  f.wheel();
  expect(f.view.getAllByRole("heading", { name: i18n.t("error.unexpectedError") })).toHaveLength(1);
  expect(f.scroller.textContent).toContain(boom.message);
  expect(f.errors.mock.calls.some(args => args.includes(boom))).toBe(true);
  expect(f.notifications).not.toHaveBeenCalled();
  expect(f.releases).toEqual([]);
  f.view.unmount();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("M7: chains a subpixel logical maximum even when physical scrollTop rounded down", () => {
  const f = fixture(true);
  f.wheel({ deltaY: 0.25 });
  expect(f.scroller.scrollTop).toBe(0);
  expect(f.current().virtualizer.scrollOffset).toBe(0.25);
  Object.defineProperty(f.scroller, "scrollHeight", { value: 671.25 });
  f.releases.length = 0;
  expect(f.wheel({ deltaY: 1 }).defaultPrevented).toBe(false);
  expect(f.releases).toEqual([]);
  expect(f.current().virtualizer.scrollOffset).toBe(0.25);
});

it("does not release into a replacement viewport or roll back its newly installed observer", () => {
  const f = fixture();
  const replacement = document.createElement("div");
  document.body.append(replacement);
  replacement.scrollTop = 321;
  Object.defineProperties(replacement, {
    offsetWidth: { value: 1000 }, offsetHeight: { value: 671 },
    clientHeight: { value: 671 }, scrollHeight: { value: 100000 },
  });
  replacement.scrollTo = vi.fn();
  f.duringCommit(() => f.setSource(replacement));
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.current().virtualizer.scrollElement).toBe(replacement);
  expect(f.scroller.scrollTop).toBe(0);
  expect(f.releases).toEqual([]);
  expect(replacement.scrollTop).toBe(321);
  expect(replacement.scrollTo).not.toHaveBeenCalled();
  // The successor observer remains live after the old transaction exits.
  act(() => { replacement.scrollTop = 700; replacement.dispatchEvent(new Event("scroll")); });
  expect(f.current().virtualizer.scrollOffset).toBe(700);
});

it("M8: removes every wheel listener across commits and unmount", () => {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = HTMLElement.prototype.addEventListener;
  const remove = HTMLElement.prototype.removeEventListener;
  vi.spyOn(HTMLElement.prototype, "addEventListener").mockImplementation(function (this: HTMLElement, type, listener, options) {
    if (type === "wheel" && typeof options === "object" && options.passive === false) listeners.add(listener);
    return add.call(this, type, listener, options);
  });
  vi.spyOn(HTMLElement.prototype, "removeEventListener").mockImplementation(function (this: HTMLElement, type, listener, options) {
    if (type === "wheel") listeners.delete(listener);
    return remove.call(this, type, listener, options);
  });
  const f = fixture();
  expect(listeners.size).toBe(1);
  f.wheel();
  f.wheel({ deltaY: -100 });
  expect(listeners.size).toBe(1);
  f.view.unmount();
  expect(listeners.size).toBe(0);
});

// The captured WebKit input41 state, through the real message hook and core.
function terminalFixture({ end = 83463.59375, origin = 55.25, border = 0, padding = 0, hiddenTail = false } = {}) {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  const notifications = vi.spyOn(toast, "error");
  const scroller = document.createElement("div");
  const host = document.createElement("div");
  host.style.position = "relative";
  host.style.borderTop = `${border}px solid`;
  host.style.paddingTop = `${padding}px`;
  document.body.append(scroller);
  scroller.append(host);
  Object.defineProperties(scroller, {
    offsetWidth: { value: 1180 }, offsetHeight: { value: 671 },
    clientHeight: { value: 671 }, clientTop: { value: 1 },
    scrollHeight: { value: Math.round(end) },
  });
  const total = end - origin;
  const rowHeight = (total - 127.75) / (hiddenTail ? 854 : 855);
  const rect = (top: number, height: number) => ({ x: 260, y: top, top, bottom: top + height, left: 260, right: 1440, width: 1180, height, toJSON() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const viewportTop = 201.25;
    if (this === scroller) return rect(viewportTop - 1, 672.75);
    if (this === host) return rect(viewportTop + origin - border - scroller.scrollTop, total + padding + border);
    const index = Number(this.dataset.index);
    const height = hiddenTail && index === 855 ? 0 : index === (hiddenTail ? 854 : 855) ? 127.75 : rowHeight;
    const translate = Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0);
    return rect(viewportTop + origin + translate - scroller.scrollTop, height);
  });
  const messages = Array.from({ length: 855 }, (_, i) => ({ uuid: `terminal-${i}`, type: "assistant", timestamp: "2026-06-30T00:00:00Z", content: [{ type: "tool_use", id: `terminal-tool-${i}`, name: "Read", input: { file_path: "a".repeat(3000) } }] })) as ClaudeMessage[];
  let current: ReturnType<typeof useMessageVirtualization>;
  function Harness() {
    current = useMessageVirtualization({ messages, agentTaskGroups: new Map(), agentTaskMemberUuids: new Set(), agentProgressGroups: new Map(), agentProgressMemberUuids: new Set(), taskOperationGroups: new Map(), taskOperationMemberUuids: new Set(), getScrollElement: () => scroller, scrollMargin: 56 });
    return <>{current.virtualRows.map(row => <div key={row.key} data-index={row.index} ref={current.virtualizer.measureElement} aria-hidden={hiddenTail && row.index === 855 ? "true" : undefined} style={{ position: "absolute", top: 0, transform: `translateY(${row.start - 56}px)` }} />)}</>;
  }
  const view = render(<Harness />, { container: host });
  // Seed the exact already-measured state at the failing real input, not an estimate.
  act(() => { for (let i = 0; i < 856; i++) current.virtualizer.resizeItem(i, hiddenTail && i === 855 ? 0 : i === (hiddenTail ? 854 : 855) ? 127.75 : rowHeight); });
  act(() => { scroller.scrollTop = 82723; scroller.dispatchEvent(new Event("scroll")); });
  const releases: number[] = [];
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => { if (typeof options === "object") { releases.push(options.top!); scroller.scrollTop = Math.round(options.top!); } });
  const wheel = () => { const event = new WheelEvent("wheel", { deltaY: 1403.271186440678, bubbles: true, cancelable: true }); act(() => { scroller.dispatchEvent(event); }); return event; };
  return { scroller, host, current: () => current!, releases, notifications, wheel, view };
}

it("accepts input41's measured contiguous fractional terminal extent without a false error", () => {
  const f = terminalFixture();
  expect(f.current().virtualRows.at(-1)?.index).toBe(855);
  expect(f.current().virtualizer.getTotalSize()).toBeCloseTo(83408.34375, 7);
  const tail = f.current().virtualizer.elementsCache.get(f.current().virtualRows.at(-1)!.key)!;
  const viewportTop = f.scroller.getBoundingClientRect().top + f.scroller.clientTop;
  expect(tail.getBoundingClientRect().bottom - viewportTop + 82723).toBeCloseTo(83463.59375, 7);
  expect(f.current().virtualizer.scrollOffset).toBe(82723);
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.releases).toEqual([82793]);
  expect(f.scroller.scrollTop).toBe(82793);
  expect(f.current().virtualizer.scrollOffset).toBe(82793);
  expect(f.notifications).not.toHaveBeenCalled();
});

it.each([
  { end: 83463.09375, origin: 55.25, dpr: 1 },
  { end: 83464.09375, origin: 55.25, dpr: 2 },
  { end: 83463.59375, origin: 61.125, border: 0.75, padding: 7.5, dpr: 3 },
  { end: 83463.59375, origin: 55.25, hiddenTail: true, dpr: 2 },
])("certifies fractional end from measured terminal provenance %j", config => {
  vi.stubGlobal("devicePixelRatio", config.dpr);
  const f = terminalFixture(config);
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.releases).toEqual([Math.round(config.end) - 671]);
  expect(f.notifications).not.toHaveBeenCalled();
});

it.each([0.25, 1])("rejects a genuine %s px interior hole even with a certified final row", gap => {
  const f = terminalFixture();
  const original = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const box = original.call(this);
    return this.dataset.index === "852" ? { ...box, top: box.top + gap, bottom: box.bottom + gap } : box;
  });
  f.wheel();
  expect(f.releases).toEqual([]);
  expect(f.scroller.scrollTop).toBe(82723);
  expect(f.current().virtualizer.scrollOffset).toBe(82723);
  expect(f.notifications).toHaveBeenCalledTimes(1);
});

it.each(["unmeasured", "unmounted", "wrong-index", "wrong-key", "truncated", "stale-position"])("rejects %s terminal evidence instead of clipping to its last mounted box", defect => {
  const f = terminalFixture();
  const v = f.current().virtualizer;
  const last = v.getVirtualItems().at(-1)!;
  const node = v.elementsCache.get(last.key)!;
  if (defect === "unmeasured") {
    const get = v.itemSizeCache.get.bind(v.itemSizeCache);
    vi.spyOn(v.itemSizeCache, "get").mockImplementation(key => key === last.key ? undefined : get(key));
  }
  if (defect === "unmounted") v.elementsCache.delete(last.key);
  if (defect === "wrong-index") node.setAttribute("data-index", "854");
  if (defect === "wrong-key") { v.elementsCache.delete(last.key); v.elementsCache.set("stale-key", node); }
  if (defect === "truncated" || defect === "stale-position") {
    const original = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const box = original.call(this);
      return this !== node ? box : defect === "truncated"
        ? { ...box, bottom: box.bottom - 0.25, height: box.height - 0.25 }
        : { ...box, top: box.top - 0.25, bottom: box.bottom - 0.25 };
    });
  }
  f.wheel();

  expect(f.releases).toEqual([]);
  expect(f.scroller.scrollTop).toBe(82723);
  expect(f.current().virtualizer.scrollOffset).toBe(82723);
  expect(f.notifications).toHaveBeenCalledTimes(1);
});

it("recovers after a rejected fractional tail without retaining the failure episode", () => {
  const f = terminalFixture();
  const original = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const box = original.call(this);
    return this.dataset.index === "855" ? { ...box, bottom: box.bottom - 1, height: box.height - 1 } : box;
  });
  f.wheel();
  expect(f.releases).toEqual([]);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(original);
  f.wheel();
  expect(f.releases).toEqual([82793]);
  expect(f.notifications).toHaveBeenCalledTimes(1);
  expect(f.current().virtualizer.scrollOffset).toBe(82793);
});

afterEach(() => { cleanup(); toast.dismiss(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
