import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  beginPendingLoad,
  getPendingLoadCount,
  usePendingLoad,
  usePendingLoadCount,
} from "./usePendingLoad";

describe("usePendingLoad", () => {
  it("registers a load only while active and releases it on unmount", () => {
    const { rerender, unmount } = renderHook(({ active }) => usePendingLoad(active), {
      initialProps: { active: true },
    });
    expect(getPendingLoadCount()).toBe(1);
    rerender({ active: false });
    expect(getPendingLoadCount()).toBe(0);
    rerender({ active: true });
    expect(getPendingLoadCount()).toBe(1);
    unmount();
    expect(getPendingLoadCount()).toBe(0);
  });

  it("re-renders count subscribers and ignores a double release", () => {
    const Count = () => <span data-testid="count">{usePendingLoadCount()}</span>;
    const { getByTestId } = render(<Count />);
    expect(getByTestId("count")).toHaveTextContent("0");

    let release = () => {};
    act(() => {
      release = beginPendingLoad();
    });
    expect(getByTestId("count")).toHaveTextContent("1");
    act(() => {
      release();
      release();
    });
    expect(getByTestId("count")).toHaveTextContent("0");
    expect(getPendingLoadCount()).toBe(0);
  });
});
