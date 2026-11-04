import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "@/types";
import { useFilterReadingPosition } from "@/components/MessageViewer/hooks/useFilterReadingPosition";

const store = vi.hoisted(() => ({ listeners: new Set<(state: Record<string, unknown>, previous: Record<string, unknown>) => void>() }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: { subscribe: (fn: (state: Record<string, unknown>, previous: Record<string, unknown>) => void) => { store.listeners.add(fn); return () => store.listeners.delete(fn); } } }));
const messages = [] as ClaudeMessage[];
function fixture() {
  const viewport = document.createElement("div");
  const row = document.createElement("div"); row.dataset.messageUuid = "read-source"; viewport.append(row); document.body.append(viewport);
  Object.defineProperties(viewport, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } });
  viewport.scrollTop = 500;
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
  let start = 550;
  row.getBoundingClientRect = () => ({ top: start - viewport.scrollTop, bottom: start - viewport.scrollTop + 100, height: 100 } as DOMRect);
  const restoringRef = { current: false };
  const props = { sessionPath: "session-A", messages, getScrollElement: () => viewport, getScrollIndex: vi.fn((): number | null => 4), virtualizer: { getOffsetForIndex: vi.fn(() => [700]) } as unknown as Virtualizer<HTMLElement, Element>, explicitTarget: null as string | null, restoringRef };
  const hook = renderHook(options => useFilterReadingPosition(options), { initialProps: props });
  const capture = () => act(() => { const previous = { selectedSession: { file_path: "session-A" }, targetMessageUuid: null, messageFilter: {}, showSystemMessages: false }; for (const fn of store.listeners) fn({ ...previous, messageFilter: {} }, previous); });
  const change = () => { start = 700; hook.rerender({ ...props, messages: [] }); };
  return { viewport, row, props, hook, capture, change, move: (value: number) => { start = value; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); expect(store.listeners.size).toBe(0); });
describe("filter source-anchor ownership", () => {
  it("captures old DOM before the projection changes and corrects later measurements", () => {
    const f = fixture(); f.capture(); f.change(); expect(f.viewport.scrollTop).toBe(650);
    f.move(730); act(() => vi.advanceTimersByTime(20)); expect(f.viewport.scrollTop).toBe(680);
    act(() => vi.advanceTimersByTime(600)); expect(f.props.restoringRef.current).toBe(false);
  });
  it("does not restore an anchor removed by the filter", () => {
    const f = fixture(); f.capture(); f.props.getScrollIndex.mockReturnValue(null); f.row.remove(); f.change(); expect(f.viewport.scrollTop).toBe(500); expect(f.props.restoringRef.current).toBe(false);
  });
  it("lets an explicit search or navigation target own the viewport", () => {
    const f = fixture(); f.hook.rerender({ ...f.props, explicitTarget: "target" }); f.capture(); f.change(); expect(f.viewport.scrollTop).toBe(500);
  });
  it("cancels pending work on session change", () => {
    const f = fixture(); f.capture(); f.move(900); f.hook.rerender({ ...f.props, sessionPath: "session-B", messages: [] }); act(() => vi.advanceTimersByTime(600)); expect(f.viewport.scrollTop).toBe(500);
  });
  it("does not pull a reader back after a new wheel gesture", () => {
    const f = fixture(); f.capture(); f.change(); f.viewport.dispatchEvent(new Event("wheel")); f.viewport.scrollTop = 900; f.move(1000); act(() => vi.advanceTimersByTime(600)); expect(f.viewport.scrollTop).toBe(900); expect(f.props.restoringRef.current).toBe(false);
  });
  it("does not react to append/prepend without a display filter change", () => {
    const f = fixture(); f.change(); expect(f.viewport.scrollTop).toBe(500); expect(f.props.restoringRef.current).toBe(false);
  });
  it("clears a no-op HTTP filter anchor before a later append", () => {
    const f = fixture(); f.capture();
    const previous = { selectedSession: { file_path: "session-A" }, targetMessageUuid: null, messageFilter: {}, showSystemMessages: false, messages, pagination: { isLoadingMore: false }, isLoadingMessages: false };
    act(() => { for (const fn of store.listeners) fn({ ...previous, pagination: { isLoadingMore: false } }, previous); });
    f.change(); expect(f.viewport.scrollTop).toBe(500);
  });
  it("yields a pending filter anchor to a real append or prepend", () => {
    const f = fixture(); f.capture();
    const previous = { selectedSession: { file_path: "session-A" }, targetMessageUuid: null, messageFilter: {}, showSystemMessages: false, messages };
    act(() => { for (const fn of store.listeners) fn({ ...previous, messages: [], messageUpdateKind: "tail-refresh" }, previous); });
    f.change(); expect(f.viewport.scrollTop).toBe(500);
  });
});
