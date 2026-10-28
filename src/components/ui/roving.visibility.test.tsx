import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Segmented, SegmentedItem } from "./segmented";
import { ChipToggleGroup } from "./chipToggle";

// JSDOM has no layout: exercise its real CSS cascade, never fabricate client rects.
// Native Tab, media queries and ResizeObserver are covered in the two-engine suite.
describe("CSS-hidden roving items", () => {
  for (const visibility of ["hidden", "collapse"] as const) {
    for (const inherited of [false, true]) {
      it(`excludes computed ${inherited ? "inherited" : "direct"} ${visibility} in radio and toolbar`, () => {
        render(<>
          <Segmented value="a" onValueChange={() => {}}>
            <span style={inherited ? { visibility } : undefined}><SegmentedItem value="a" style={!inherited ? { visibility } : undefined}>A</SegmentedItem></span>
            <SegmentedItem value="b">B</SegmentedItem>
          </Segmented>
          <ChipToggleGroup><span style={inherited ? { visibility } : undefined}><button style={!inherited ? { visibility } : undefined}>A</button></span><button>B</button></ChipToggleGroup>
        </>);
        for (const role of ["radio", "button"]) {
          const buttons = screen.getAllByRole(role, { hidden: true }).filter((button) => button.getAttribute("role") === (role === "radio" ? "radio" : null));
          expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0]);
        }
      });
    }
    it(`allows a visible child to override inherited ${visibility}`, () => {
      render(<Segmented value="a" onValueChange={() => {}}>
        <span style={{ visibility }}><SegmentedItem value="a" style={{ visibility: "visible" }}>A</SegmentedItem></span>
        <SegmentedItem value="b">B</SegmentedItem>
      </Segmented>);
      expect(screen.getAllByRole("radio").map((button) => button.tabIndex)).toEqual([0, -1]);
    });
  }
  it("bounds and cleans up availability subscriptions across StrictMode replay and commits", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    try {
      const tree = (value: string) => <StrictMode><Segmented value={value} onValueChange={() => {}}><SegmentedItem value="a">A</SegmentedItem><SegmentedItem value="b">B</SegmentedItem></Segmented></StrictMode>;
      const view = render(tree("a"));
      const group = screen.getByRole("radiogroup");
      view.rerender(tree("b"));
      expect(screen.getAllByRole("radio").map((button) => button.tabIndex)).toEqual([-1, 0]);
      const resizeAdds = add.mock.calls.filter(([type]) => type === "resize");
      // Actual development StrictMode setup/cleanup/setup plus the next commit.
      expect(resizeAdds).toHaveLength(3);
      expect(disconnect).toHaveBeenCalledTimes(2);
      for (const [target, options] of observe.mock.calls) {
        expect(options?.attributeFilter).not.toContain("tabindex");
        if (options?.subtree) expect(target).toBe(group);
        else expect((target as Element).contains(group)).toBe(true);
      }
      view.unmount();
      expect(disconnect).toHaveBeenCalledTimes(3);
      expect(remove.mock.calls.filter(([type]) => type === "resize")).toEqual(resizeAdds);
    } finally { vi.restoreAllMocks(); }
  });
  for (const ancestor of [false, true]) {
    it(`skips a ${ancestor ? "hidden ancestor's" : "CSS-hidden"} selected radio`, () => {
      const requests: string[] = [];
      render(<Segmented value="a" onValueChange={(value) => requests.push(value)}>
        <span style={ancestor ? { display: "none" } : undefined}>
          <SegmentedItem value="a" style={!ancestor ? { display: "none" } : undefined}>A</SegmentedItem>
        </span>
        <SegmentedItem value="b">B</SegmentedItem>
        <SegmentedItem value="locked" disabled>Locked</SegmentedItem>
        <SegmentedItem value="c">C</SegmentedItem>
      </Segmented>);
      const [a, b, locked, c] = screen.getAllByRole("radio", { hidden: true });
      expect([a.tabIndex, b.tabIndex, locked.tabIndex, c.tabIndex]).toEqual([-1, 0, -1, -1]);
      b.focus();
      fireEvent.keyDown(b, { key: "ArrowRight" });
      expect(c).toHaveFocus();
      expect(requests).toEqual(["c"]);
      expect([a.tabIndex, b.tabIndex, locked.tabIndex, c.tabIndex]).toEqual([-1, 0, -1, -1]);
    });
  }
  it("uses the same visible/disabled policy for toolbar entry and arrows", () => {
    render(<ChipToggleGroup>
      <button style={{ display: "none" }}>A</button>
      <button>B</button>
      <span style={{ display: "none" }}><button>C</button></span>
      <button disabled>Locked</button>
      <button aria-disabled="true">Aria locked</button>
      <button>D</button>
    </ChipToggleGroup>);
    const [a, b, c, locked, ariaLocked, d] = screen.getAllByRole("button", { hidden: true });
    expect([a, b, c, locked, ariaLocked, d].map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    b.focus();
    fireEvent.keyDown(b, { key: "ArrowRight" });
    expect(d).toHaveFocus();
    expect([b.tabIndex, d.tabIndex]).toEqual([-1, 0]);
  });
});
