/**
 * Radio menu selection mark (T5 review, finding 1).
 *
 * The checked radio item shows a dot. Radix's `ItemIndicator` is an inline
 * span, so the dot is not a flex item: an inline span ignores `w-*` / `h-*`
 * and renders 0 × 0 (measured in WebKit). The dot must be a box
 * (`block` / `inline-block`) with both dimensions. jsdom cannot measure, so
 * this checks the classes; `scripts/ui-capture/test/stateIcons.test.mjs`
 * measures the same markup in real WebKit.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

function renderRadioMenu(value: string) {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value}>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="ko">한국어</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The mark Radix's ItemIndicator wraps in a radio item (null when it renders none). */
function selectionMark(item: HTMLElement): HTMLElement | null {
  return item.querySelector<HTMLElement>("span[data-state] > *");
}

describe("DropdownMenuRadioItem selection mark", () => {
  it("draws a sized box dot on the checked item only", () => {
    renderRadioMenu("en");
    const checked = screen.getByRole("menuitemradio", { name: "English" });
    const unchecked = screen.getByRole("menuitemradio", { name: "한국어" });
    expect(checked.getAttribute("aria-checked")).toBe("true");

    const mark = selectionMark(checked);
    expect(mark, "checked item has a selection mark").not.toBeNull();
    const classes = (mark?.className ?? "").split(/\s+/);
    // A box, so its width / height apply inside Radix's inline indicator span.
    expect(classes.some((c) => c === "block" || c === "inline-block" || c === "flex")).toBe(true);
    expect(classes).toContain("w-2");
    expect(classes).toContain("h-2");
    expect(classes).toContain("bg-current");

    expect(selectionMark(unchecked)).toBeNull();
  });
});
