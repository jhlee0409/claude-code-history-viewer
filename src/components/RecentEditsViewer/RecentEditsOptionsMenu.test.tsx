import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

import { RecentEditsOptionsMenu } from "./RecentEditsOptionsMenu";

// Radix opens the menu from a keyboard event as well as a pointer one, and the
// keyboard path is the one that works reliably under jsdom.
const open = () => {
  fireEvent.keyDown(screen.getByRole("button", { name: "Panel options" }), {
    key: "Enter",
  });
};

const defaults = {
  grouping: "file" as const,
  onGroupingChange: vi.fn(),
  missingOnly: false,
  onMissingOnlyChange: vi.fn(),
};

describe("RecentEditsOptionsMenu", () => {
  it("labels the icon-only trigger", () => {
    render(<RecentEditsOptionsMenu {...defaults} />);

    const trigger = screen.getByRole("button", { name: "Panel options" });
    expect(trigger.getAttribute("aria-label")).toBe("Panel options");
    expect(trigger.getAttribute("title")).toBe("Panel options");
  });

  it("reflects slice state on both radio groups", () => {
    render(
      <RecentEditsOptionsMenu {...defaults} grouping="edit" missingOnly={true} />
    );
    open();

    expect(
      screen
        .getByRole("menuitemradio", { name: "Edit (chronological)" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemradio", { name: "Missing on disk only" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("reports a grouping change", () => {
    const onGroupingChange = vi.fn();
    render(
      <RecentEditsOptionsMenu
        {...defaults}
        onGroupingChange={onGroupingChange}
      />
    );
    open();

    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Edit (chronological)" })
    );

    expect(onGroupingChange).toHaveBeenCalledWith("edit");
  });

  it("reports a filter change", () => {
    const onMissingOnlyChange = vi.fn();
    render(
      <RecentEditsOptionsMenu
        {...defaults}
        onMissingOnlyChange={onMissingOnlyChange}
      />
    );
    open();

    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Missing on disk only" })
    );

    expect(onMissingOnlyChange).toHaveBeenCalledWith(true);
  });

  it("does not offer undocking, which the header toggle owns", () => {
    // Undocking moved to the Page/Sidebar toggle in the panel header. Two
    // controls for one state, in two vocabularies and only one of them showing
    // the current value, is worse than one.
    render(<RecentEditsOptionsMenu {...defaults} />);
    open();

    expect(screen.queryByText("Undock to full page")).toBeNull();
  });
});
