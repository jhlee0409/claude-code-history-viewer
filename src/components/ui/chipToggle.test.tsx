import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as UI from "./index";

describe("independent toggles", () => {
  it("offers a toolbar with one Tab stop, roving without toggling and independent activation", () => {
    expect(UI).toHaveProperty("ChipToggleGroup");
    expect(UI).toHaveProperty("ChipToggle");
    const { ChipToggle, ChipToggleGroup } = UI;
    const change = vi.fn();
    render(<ChipToggleGroup aria-label="Filters"><ChipToggle pressed onPressedChange={change}>User</ChipToggle><ChipToggle pressed={false} onPressedChange={change}>Assistant</ChipToggle><ChipToggle pressed disabled onPressedChange={change}>Disabled</ChipToggle></ChipToggleGroup>);
    expect(screen.getByRole("toolbar", { name: "Filters" })).toBeInTheDocument();
    const [user, assistant, disabled] = screen.getAllByRole("button");
    expect([user!.tabIndex, assistant!.tabIndex, disabled!.tabIndex]).toEqual([0, -1, -1]);
    fireEvent.keyDown(user!, { key: "ArrowRight" });
    expect(assistant).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
    expect(user).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(assistant!);
    expect(change).toHaveBeenCalledExactlyOnceWith(true);
    fireEvent.click(disabled!);
    expect(change).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(assistant!, { key: "ArrowRight" });
    expect(user).toHaveFocus();
  });
});
