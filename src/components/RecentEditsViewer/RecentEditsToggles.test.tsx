import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

import {
  RecentEditsScopeToggle,
  RecentEditsDensityToggle,
} from "./RecentEditsToggles";

describe("RecentEditsScopeToggle", () => {
  it("reflects the selected scope through aria-pressed", () => {
    render(<RecentEditsScopeToggle value="session" onChange={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Session" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Project" }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("calls onChange with the clicked scope", () => {
    const onChange = vi.fn();
    render(<RecentEditsScopeToggle value="session" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Project" }));

    expect(onChange).toHaveBeenCalledWith("project");
  });

  it("disables both buttons and explains why when no session is selected", () => {
    const onChange = vi.fn();
    const { container } = render(
      <RecentEditsScopeToggle value="project" onChange={onChange} disabled />
    );

    for (const name of ["Session", "Project"]) {
      const button = screen.getByRole("button", { name });
      expect(button.hasAttribute("disabled")).toBe(true);
    }

    fireEvent.click(screen.getByRole("button", { name: "Session" }));
    expect(onChange).not.toHaveBeenCalled();

    // The hint lives on the wrapper, because a disabled button does not
    // reliably fire the events a native tooltip needs.
    expect(
      container.querySelector('[title="Select a session to scope edits to it"]')
    ).toBeTruthy();
  });
});

describe("RecentEditsDensityToggle", () => {
  it("reflects the selected density through aria-pressed", () => {
    render(<RecentEditsDensityToggle value="compact" onChange={() => {}} />);

    expect(
      screen
        .getByRole("button", { name: "Compact rows" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Full cards" })
        .getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("calls onChange with the clicked density", () => {
    const onChange = vi.fn();
    render(<RecentEditsDensityToggle value="compact" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Full cards" }));

    expect(onChange).toHaveBeenCalledWith("standard");
  });

  it("labels its icon-only buttons for both screen readers and pointer users", () => {
    const { container } = render(
      <RecentEditsDensityToggle value="compact" onChange={() => {}} />
    );

    for (const button of Array.from(container.querySelectorAll("button"))) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.getAttribute("title")).toBeTruthy();
      // Icon-only: no text content to fall back on.
      expect((button.textContent ?? "").trim()).toBe("");
    }
  });
});
