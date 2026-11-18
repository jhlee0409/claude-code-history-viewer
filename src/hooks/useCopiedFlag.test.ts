import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopiedFlag } from "./useCopiedFlag";

describe("useCopiedFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resets after the given delay", () => {
    const { result } = renderHook(() => useCopiedFlag(1500));
    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe(false);
  });

  // An uncleared reset timer fired after jsdom teardown and failed develop's
  // Frontend CI with "window is not defined" (OutputBlock copy button).
  it("leaves no pending timer once unmounted", () => {
    const { result, unmount } = renderHook(() => useCopiedFlag(1500));
    act(() => {
      result.current[1]();
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
