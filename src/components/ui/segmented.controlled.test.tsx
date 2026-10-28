import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Segmented, SegmentedItem } from "./segmented";

describe("controlled radio Tab entry", () => {
  // Independent round-1 repro: focus may move even when selection is rejected.
  it("keeps the checked value as the sole Tab stop when the parent declines a request", () => {
    const requests: string[] = [];
    render(<Segmented value="a" onValueChange={(value) => requests.push(value)} aria-label="controlled">
      <SegmentedItem value="a">A</SegmentedItem>
      <SegmentedItem value="b">B</SegmentedItem>
      <SegmentedItem value="c">C</SegmentedItem>
    </Segmented>);
    const a = screen.getByRole("radio", { name: "A" });
    const b = screen.getByRole("radio", { name: "B" });
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(requests).toEqual(["b"]);
    expect(b).toHaveFocus();
    expect(a).toHaveAttribute("aria-checked", "true");
    expect(b).toHaveAttribute("aria-checked", "false");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
  });

  it("takes external committed values without stealing focus and falls back only when no checked item is enabled", () => {
    const view = (value: string, disabled: boolean) => <Segmented value={value} onValueChange={() => {}} aria-label="external">
      <SegmentedItem value="a">A</SegmentedItem>
      <SegmentedItem value="b">B</SegmentedItem>
      <SegmentedItem value="c" disabled={disabled}>C</SegmentedItem>
    </Segmented>;
    const { rerender } = render(view("a", false));
    const a = screen.getByRole("radio", { name: "A" });
    const b = screen.getByRole("radio", { name: "B" });
    const c = screen.getByRole("radio", { name: "C" });
    b.focus();
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([0, -1, -1]);
    rerender(view("c", false));
    expect(b).toHaveFocus();
    expect(c).toHaveAttribute("aria-checked", "true");
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([-1, -1, 0]);
    rerender(view("c", true));
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([0, -1, -1]);
    b.focus();
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([0, -1, -1]);
    rerender(view("missing", false));
    expect([a.tabIndex, b.tabIndex, c.tabIndex]).toEqual([0, -1, -1]);
  });
});
