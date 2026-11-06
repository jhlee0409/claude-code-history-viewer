import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import type { ClaudeMessage } from "@/types";

function fixture(quantize = false, enabled = true) {
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
    wheelTransactionPrototype: enabled,
  };
  let current: ReturnType<typeof useMessageVirtualization>;
  function Harness() {
    current = useMessageVirtualization(options);
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
  const view = render(<Harness />, { container: scroller });
  releases.length = 0;
  const wheel = (init: WheelEventInit = {}, target: HTMLElement = scroller, native = false) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 3795.779541015625, ...init });
    if (native) target.dispatchEvent(event);
    else act(() => { target.dispatchEvent(event); });
    return event;
  };
  return { scroller, wheel, releases, covered, errors, view, current: () => current!,
    setSource: (element: HTMLElement | null) => { source = element; },
    duringCommit: (action: () => void) => { duringCommit = action; },
    throwDuringRender: (error: Error) => { renderError = error; },
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

it("keeps keyboard, direct scrolling, message jumps and disabled wheel on their original paths", () => {
  const f = fixture(false, false);
  expect(f.wheel().defaultPrevented).toBe(false);
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
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/could not scroll/i);
  } finally { window.removeEventListener("error", handle); }
});

it("probe A: actual renderer failure leaves a visible fallback and no throwing wheel listener on an unmounted owner", () => {
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
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/could not scroll/i);
    expect(f.errors.mock.calls.some(args => args.includes(boom))).toBe(true);
    // The failed tree cannot reconcile native scrolls; detached logical state
    // is not reused or written into a replacement owner.
    expect(f.current().virtualizer.scrollElement).toBeNull();
    expect(f.wheel({ ctrlKey: true }).defaultPrevented).toBe(false);
  } finally { window.removeEventListener("error", handle); }
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
