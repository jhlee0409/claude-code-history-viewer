import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useMessageVirtualization } from "@/components/MessageViewer/hooks/useMessageVirtualization";
import { estimateMessageHeight } from "@/components/MessageViewer/helpers/heightEstimation";
import type { ClaudeMessage } from "@/types";
import capture from "./fixtures/wheel-destination-capture.json";

// JSDOM has no layout or native sizer clamping. The captured browser transition
// shrank the sizer during the commit: 33741 -> 32255, before physical release.
// Model that rule, not an injected fixed scroll shift or a 671px guard deficit.
function fixture(clamp = true) {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error");
  const notifications = vi.spyOn(toast, "error");
  const observers: { callback: ResizeObserverCallback; nodes: Set<Element> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    record: (typeof observers)[number];
    constructor(callback: ResizeObserverCallback) { this.record = { callback, nodes: new Set() }; observers.push(this.record); }
    observe(node: Element) { this.record.nodes.add(node); }
    unobserve(node: Element) { this.record.nodes.delete(node); }
    disconnect() { this.record.nodes.clear(); }
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  const scroller = document.createElement("div"), host = document.createElement("div");
  host.style.position = "relative";
  scroller.append(host); document.body.append(scroller);
  const origin = capture.commits[0]!.boxes.at(-1)!.bottom - capture.commits[0]!.viewportTop + capture.commits[0]!.physical - capture.commits[0]!.total;
  const viewportTop = capture.commits[0]!.viewportTop;
  const viewportHeight = capture.commits[0]!.clientHeight;
  let physical = 0, prefixHeight = 300, inWheel = false;
  let defect: "gap" | "missing" | "foreign" | undefined;
  let moved: { node: HTMLElement; parent: HTMLElement } | undefined;
  const heightOverrides = new Map<number, number>();
  const heightOf = (index: number) => heightOverrides.get(index) ?? capture.commits[1]!.boxes.find(b => b.index === index)?.height ?? prefixHeight;
  const sizerHeight = () => parseFloat(host.querySelector<HTMLElement>("[data-sizer]")?.style.height ?? "100000");
  const extent = () => Math.round(origin + sizerHeight());
  Object.defineProperties(scroller, {
    offsetWidth: { value: 1180 }, offsetHeight: { value: viewportHeight }, clientHeight: { value: viewportHeight },
    scrollHeight: { get: extent },
    scrollTop: {
      get: () => { if (clamp) physical = Math.min(physical, Math.max(0, extent() - viewportHeight)); return physical; },
      set: (value: number) => { physical = Math.max(0, Math.min(Math.round(value), extent() - viewportHeight)); },
    },
  });
  let current: ReturnType<typeof useMessageVirtualization>;
  const rect = (top: number, height: number) => ({ x: 0, y: top, top, bottom: top + height, left: 0, right: 1180, width: 1180, height, toJSON() {} });
  // Independent oracle: move actual viewport-space DOM boxes by the distance
  // from CURRENT native scrollTop to proposed destination. No core row.start,
  // product coveredUntil, old input offset, or captured deficit enters this.
  const coverage = (destination: number) => {
    const native = scroller.scrollTop;
    const boxes = [...host.querySelectorAll<HTMLElement>("[data-index]")].map(node => {
      const b = node.getBoundingClientRect();
      return { top: b.top + native - destination - viewportTop, bottom: b.bottom + native - destination - viewportTop };
    }).sort((a, b) => a.top - b.top);
    let end = 0;
    for (const b of boxes) {
      if (b.bottom <= end) continue;
      if (b.top > end + 0.01) break;
      end = b.bottom;
    }
    return { physical: native, destination, end, covered: end >= viewportHeight };
  };
  const checks: ReturnType<typeof coverage>[] = [], releases: ReturnType<typeof coverage>[] = [];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === scroller) {
      if (inWheel) {
        if ((defect === "missing" || defect === "foreign") && !moved) {
          const node = host.querySelector<HTMLElement>('[data-index="114"]')!;
          moved = { node, parent: node.parentElement! };
          if (defect === "missing") node.remove();
          else document.body.append(node);
        }
        checks.push(coverage(current.virtualizer.scrollOffset!));
      }
      return rect(viewportTop, viewportHeight);
    }
    if (this === host) return rect(viewportTop + origin - scroller.scrollTop, sizerHeight());
    return rect(viewportTop + origin + Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0) - scroller.scrollTop + (defect === "gap" && this.dataset.index === "114" ? 0.25 : 0), heightOf(Number(this.dataset.index)));
  });
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options !== "object") return;
    const destination = options.top ?? scroller.scrollTop;
    if (inWheel) releases.push(coverage(destination));
    scroller.scrollTop = destination;
  });
  const options = {
    messages: capture.messages as unknown as ClaudeMessage[], agentTaskGroups: new Map(), agentTaskMemberUuids: new Set<string>(),
    agentProgressGroups: new Map(), agentProgressMemberUuids: new Set<string>(), taskOperationGroups: new Map(), taskOperationMemberUuids: new Set<string>(),
    getScrollElement: () => scroller, scrollMargin: 68,
  };
  function Harness() {
    current = useMessageVirtualization(options);
    return <div style={{ height: current.totalSize, position: "relative" }} data-sizer>{current.virtualRows.map(row => <div key={row.key} ref={current.virtualizer.measureElement} data-index={row.index} style={{ position: "absolute", top: 0, transform: `translateY(${row.start - current.rowTranslateOffset}px)` }} />)}</div>;
  }
  // The outer relative host is the row origin; the child's height is the sizer.
  const view = render(<Harness />, { container: host });
  const estimate = (i: number) => estimateMessageHeight(current.flattenedMessages[i]!, false);
  const initial106 = capture.initial.rows.find(row => row.index === 106)!;
  const start106 = initial106.top - viewportTop + capture.initial.scrollTop - origin;
  // Only the invisible prefix's aggregate is known. Its individual fixture
  // heights are explicitly not asserted to be native captured measurements.
  prefixHeight = (start106 - Array.from({ length: 6 }, (_, i) => estimate(100 + i)).reduce((a, b) => a + b, 0)) / 100;
  act(() => {
    for (let i = 0; i < 100; i++) current.virtualizer.resizeItem(i, prefixHeight);
    for (const row of capture.initial.rows) current.virtualizer.resizeItem(row.index, row.height);
  });
  act(() => { scroller.scrollTop = capture.initial.scrollTop; scroller.dispatchEvent(new Event("scroll")); });
  // This effective DOM delta reconstructs BOTH captured commits exactly. It is
  // inferred from the recorded offsets and real core corrections, not a claim
  // that the public Playwright -536.6 request equals event.deltaY. The native
  // witness sent -536.6 twice; literal DOM -536.6 is tested independently below.
  const wheel = (deltaY = -268.29998779296875) => {
    const before = scroller.scrollTop;
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
    inWheel = true;
    try { act(() => { scroller.dispatchEvent(event); }); } finally { inWheel = false; if (moved) { moved.parent.append(moved.node); moved = undefined; } }
    return { before, event, check: checks.at(-1) };
  };
  return { scroller, host, current: () => current!, wheel, releases, checks, coverage, errors, notifications, observers, heightOverrides, view, setDefect: (value: typeof defect) => { defect = value; } };
}

it("releases both captured backward wheels when current physical DOM boxes cover their proposed destinations", () => {
  const f = fixture();
  expect(f.scroller.scrollTop).toBe(capture.initial.scrollTop);
  expect(f.current().virtualRows[0]?.index).toBe(106);
  const first = f.wheel();
  expect(first.check?.covered, "independent first destination coverage").toBe(true);
  expect(first.check?.physical).toBe(capture.commits[0]!.physical);
  expect(first.check?.destination).toBeCloseTo(capture.commits[0]!.destination, 7);
  expect(f.releases).toHaveLength(1);
  const second = f.wheel();
  expect(second.check?.physical).toBe(capture.commits[1]!.physical);
  expect(second.check?.destination).toBeCloseTo(capture.commits[1]!.destination, 7);
  expect(second.check?.covered, "independent second destination coverage before rollback/release").toBe(true);
  console.info("captured two-wheel coverage", { first, second, releases: f.releases, notifications: f.notifications.mock.calls.length });
  expect(f.releases, "a covered second destination must not falsely roll back").toHaveLength(2);
  expect(f.releases.every(r => r.covered)).toBe(true);
  expect(f.notifications).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it.each([false, true])("covers two literal -536.6 DOM events (native clamp=%s)", clamp => {
  const f = fixture(clamp);
  for (let i = 0; i < 2; i++) {
    const result = f.wheel(-536.6);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.check?.covered).toBe(true);
  }
  expect(f.releases).toHaveLength(2);
  expect(f.releases.every(r => r.covered)).toBe(true);
  expect(f.notifications).not.toHaveBeenCalled();
});

it.each(["gap", "missing", "foreign"] as const)("fails closed for a genuine %s row defect after physical clamping", defect => {
  const f = fixture();
  f.wheel();
  const priorLogical = f.current().virtualizer.scrollOffset;
  f.setDefect(defect);
  const result = f.wheel();
  expect(result.check?.covered, "independent oracle must detect the real hole").toBe(false);
  expect(f.releases, "never certify missing or foreign DOM coverage").toHaveLength(1);
  expect(f.current().virtualizer.scrollOffset).toBe(priorLogical);
  expect(f.notifications).toHaveBeenCalledTimes(1);
  expect(f.errors).not.toHaveBeenCalled();
});

it("retains real ResizeObserver height changes after a successful clamped transaction", () => {
  const f = fixture(); f.wheel(); f.wheel();
  const v = f.current().virtualizer, index = 119;
  const node = v.elementsCache.get(v.options.getItemKey(index))!;
  const previous = v.itemSizeCache.get(v.options.getItemKey(index))!;
  f.heightOverrides.set(index, previous + 32);
  act(() => {
    for (const o of f.observers) if (o.nodes.has(node)) o.callback([{
      target: node, borderBoxSize: [{ inlineSize: 1180, blockSize: previous + 32 }],
    } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  });
  expect(v.itemSizeCache.get(v.options.getItemKey(index))).toBe(previous + 32);
  const logical = v.scrollOffset!;
  const next = f.wheel(0.25);
  expect(next.check?.covered).toBe(true);
  expect(f.releases.at(-1)?.destination).toBeCloseTo(logical + 0.25, 7);
  expect(f.notifications).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

afterEach(() => { cleanup(); toast.dismiss(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
