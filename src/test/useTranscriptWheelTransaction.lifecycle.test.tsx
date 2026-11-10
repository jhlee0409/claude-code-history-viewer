import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import i18n from "@/i18n";
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
  const hook = renderHook(useTranscriptWheelTransaction);
  const transaction = hook.result.current;
  const onChange = vi.fn();
  const instance = new Virtualizer<HTMLElement, Element>({
    count: 100, getScrollElement: () => scroller, estimateSize: () => 100,
    observeElementRect: (_instance, callback) => { callback({ width: 100, height: 100 }); },
    observeElementOffset: transaction.observeOffset, scrollToFn: transaction.scrollToFn, onChange,
  });
  instance._willUpdate();
  const boundary = renderHook(() => useTranscriptWheelBoundary(instance, transaction));
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
  return { scroller, instance, transaction, onChange, boundary, wheel, hook };
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
  const report = vi.spyOn(toast, "error");
  const boom = new Error("live-render-notification-boom");
  f.onChange.mockImplementation(() => { if ((f.instance.scrollOffset ?? 0) > 100) throw boom; });
  const errors: unknown[] = [];
  const listener = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
  window.addEventListener("error", listener);
  try {
    expect(f.wheel().defaultPrevented).toBe(true);
    expect(errors).toEqual([boom]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(f.instance.scrollOffset).toBe(0.25);
    expect(f.scroller.scrollTop).toBe(0);
    expect(f.scroller.scrollTo).not.toHaveBeenCalled();
    expect(f.transaction.active.current).toBe(false);
    expect(f.instance.options.onChange).toBe(f.onChange);
    expect(toast.getToasts().some(item => "title" in item && item.title === i18n.t("error.unexpectedError"))).toBe(true);
  } finally { window.removeEventListener("error", listener); }
});

it("preserves the latest same-viewport selection and onChange instead of rolling back a new owner", () => {
  const report = vi.spyOn(toast, "error");
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
  expect(report).not.toHaveBeenCalled();
  expect(f.transaction.active.current).toBe(false);
});

it("never restores through a disposed observer even when its captured callback still exists", () => {
  const report = vi.spyOn(toast, "error");
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
  expect(report).not.toHaveBeenCalled();
  expect(f.scroller.scrollTop).toBe(0);
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  expect(f.transaction.active.current).toBe(false);
});

it.each(["en", "ko", "ja", "zh-CN", "zh-TW"])("uses the existing localized notification for coverage failure (%s)", async language => {
  await i18n.changeLanguage(language);
  const host = render(<Toaster />);
  const report = vi.spyOn(toast, "error");
  const f = fixture();
  f.wheel();
  f.wheel();
  expect(report).toHaveBeenCalledTimes(1);
  expect(report.mock.calls[0]?.[0]).toBe(i18n.t("error.unexpectedError"));
  await waitFor(() => expect(host.getByText(i18n.t("error.unexpectedError"))).toBeVisible());
  expect(f.instance.scrollOffset).toBe(0.25);
  expect(f.scroller.scrollTop).toBe(0);
  const id = report.mock.results[0]!.value;
  const dismiss = vi.spyOn(toast, "dismiss");
  f.hook.unmount();
  expect(dismiss).toHaveBeenCalledWith(id);
  expect(toast.getToasts().some(item => item.id === id)).toBe(false);
  await waitFor(() => expect(host.queryByText(i18n.t("error.unexpectedError"))).toBeNull());
});

it("keeps failure notifications viewer-scoped across other viewers' success and disposal", () => {
  const report = vi.spyOn(toast, "error");
  const first = fixture();
  const second = fixture();
  first.wheel();
  second.wheel();
  expect(report).toHaveBeenCalledTimes(2);
  const [firstId, secondId] = report.mock.results.map(result => result.value);
  expect(firstId).not.toBe(secondId);
  // Give only the first viewer actual connected coverage, then succeed.
  vi.spyOn(first.scroller, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, bottom: 10000, left: 0, right: 100, width: 100, height: 10000, toJSON() {},
  });
  first.instance.elementsCache.set("coverage", first.scroller);
  const dismiss = vi.spyOn(toast, "dismiss");
  first.wheel();
  expect(first.scroller.scrollTo).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledWith(firstId);
  expect(dismiss).not.toHaveBeenCalledWith(secondId);
  first.hook.unmount();
  expect(toast.getToasts().some(item => item.id === secondId)).toBe(true);
  second.hook.unmount();
  expect(dismiss).toHaveBeenCalledWith(secondId);
});

afterEach(() => { cleanup(); toast.dismiss(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
