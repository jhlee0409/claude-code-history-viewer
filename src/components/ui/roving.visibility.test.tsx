import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Segmented, SegmentedItem } from "./segmented";
import { ChipToggleGroup } from "./chipToggle";

// JSDOM has no layout: exercise its real CSS cascade, never fabricate client rects.
// Native Tab, media queries and ResizeObserver are covered in the two-engine suite.
describe("CSS-hidden roving items", () => {
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
