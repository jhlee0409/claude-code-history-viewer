import { act, cleanup, renderHook } from "@testing-library/react";
import { Virtualizer } from "@tanstack/react-virtual";
import { afterEach, expect, it, vi } from "vitest";
import { useTranscriptWheelBoundary, useTranscriptWheelTransaction } from "@/components/MessageViewer/hooks/useTranscriptWheelTransaction";

// Real installed core + observer; no React adapter rerender that could mask a
// missing finally restore by installing a fresh onChange during render.
function fixture() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const scroller = document.createElement("div");
  document.body.append(scroller);
  Object.defineProperties(scroller, { clientHeight: { value: 100 }, scrollHeight: { value: 10000 } });
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === "object") scroller.scrollTop = Math.round(options.top ?? 0);
  });
  const transaction = renderHook(useTranscriptWheelTransaction).result.current;
  const onChange = vi.fn();
  const instance = new Virtualizer<HTMLElement, Element>({
    count: 100, getScrollElement: () => scroller, estimateSize: () => 100,
    observeElementRect: (_instance, callback) => { callback({ width: 100, height: 100 }); },
    observeElementOffset: transaction.observeOffset, scrollToFn: transaction.scrollToFn, onChange,
  });
  instance._willUpdate();
  const boundary = renderHook(() => useTranscriptWheelBoundary(true, instance, transaction));
  // Physical rounds down; logical retains the actual prior fraction.
  instance.scrollToOffset(0.25);
  scroller.dispatchEvent(new Event("scroll"));
  expect(instance.scrollOffset).toBe(0.25);
  vi.mocked(scroller.scrollTo).mockClear();
  const wheel = () => {
    const event = new WheelEvent("wheel", { deltaY: 1000, cancelable: true });
    act(() => scroller.dispatchEvent(event));
    return event;
  };
  return { scroller, instance, transaction, onChange, boundary, wheel };
}

it("M9: restores normal onChange semantics after a failed coverage commit without adapter help", () => {
  const f = fixture();
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.instance.options.onChange).toBe(f.onChange);
  expect(f.transaction.active.current).toBe(false);
  expect(f.instance.scrollOffset).toBe(0.25);
  expect(f.scroller.scrollTop).toBe(0);
  f.onChange.mockClear();
  f.scroller.scrollTop = 800;
  act(() => f.scroller.dispatchEvent(new Event("scroll")));
  expect(f.instance.scrollOffset).toBe(800);
  expect(f.onChange.mock.calls.some(([, sync]) => sync === true)).toBe(true);
});

it("restores the exact prior logical and physical state before propagating a live-owner exception", () => {
  const f = fixture();
  const boom = new Error("live-render-notification-boom");
  f.onChange.mockImplementation(() => { if ((f.instance.scrollOffset ?? 0) > 100) throw boom; });
  const errors: unknown[] = [];
  const listener = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
  window.addEventListener("error", listener);
  try {
    expect(f.wheel().defaultPrevented).toBe(true);
    expect(errors).toEqual([boom]);
    expect(f.instance.scrollOffset).toBe(0.25);
    expect(f.scroller.scrollTop).toBe(0);
    expect(f.scroller.scrollTo).not.toHaveBeenCalled();
    expect(f.transaction.active.current).toBe(false);
    expect(f.instance.options.onChange).toBe(f.onChange);
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/could not scroll/i);
  } finally { window.removeEventListener("error", listener); }
});

it("preserves the latest same-viewport selection and onChange instead of rolling back a new owner", () => {
  const f = fixture();
  const successor = vi.fn();
  f.onChange.mockImplementation(() => {
    if ((f.instance.scrollOffset ?? 0) <= 100) return;
    f.transaction.selection.current = { session: "successor" };
    f.instance.setOptions({ ...f.instance.options, onChange: successor });
    f.scroller.scrollTop = 321;
    f.transaction.deliverOffset.current!.deliver(321, false);
  });
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(f.instance.scrollOffset).toBe(321);
  expect(f.scroller.scrollTop).toBe(321);
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  expect(f.instance.options.onChange).toBe(successor);
  expect(f.transaction.active.current).toBe(false);
});

it("never restores through a disposed observer even when its captured callback still exists", () => {
  const f = fixture();
  let disposedLogical: number | null = null;
  f.onChange.mockImplementation(() => {
    if ((f.instance.scrollOffset ?? 0) <= 100 || disposedLogical !== null) return;
    disposedLogical = f.instance.scrollOffset;
    f.instance.setOptions({ ...f.instance.options, getScrollElement: () => null });
    f.instance._willUpdate();
  });
  expect(f.wheel().defaultPrevented).toBe(true);
  expect(disposedLogical).toBe(1000);
  expect(f.instance.scrollElement).toBeNull();
  expect(f.instance.scrollOffset).toBe(disposedLogical);
  expect(f.transaction.deliverOffset.current).toBeNull();
  expect(f.scroller.scrollTop).toBe(0);
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  expect(f.transaction.active.current).toBe(false);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
