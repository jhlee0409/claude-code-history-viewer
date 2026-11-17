import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useResizablePanel } from "./useResizablePanel";

const mouseDownAt = (clientX: number) =>
  ({ clientX, preventDefault: () => {} }) as unknown as ReactMouseEvent<HTMLElement>;

describe("useResizablePanel", () => {
  it("ends a drag with the width of its last move, even before React re-renders", () => {
    const onResizeEnd = vi.fn();
    const { result } = renderHook(() =>
      useResizablePanel({ defaultWidth: 300, minWidth: 200, maxWidth: 600, direction: "left", onResizeEnd }),
    );
    act(() => result.current.handleMouseDown(mouseDownAt(500)));
    // The move and the release land in one batch: no render runs between them.
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 450 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(onResizeEnd).toHaveBeenCalledWith(350);
    expect(result.current.width).toBe(350);
  });

});
