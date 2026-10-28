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
  it("reflects the selected scope through aria-checked", () => {
    render(<RecentEditsScopeToggle value="session" onChange={() => {}} />);

    expect(
      screen.getByRole("radio", { name: "Session" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Project" }).getAttribute("aria-checked")
    ).toBe("false");
  });

  it("calls onChange with the clicked scope", () => {
    const onChange = vi.fn();
    render(<RecentEditsScopeToggle value="session" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Project" }));

    expect(onChange).toHaveBeenCalledWith("project");
  });

  it("disables only Session when there is no session to scope to", () => {
    // This previously disabled BOTH buttons. That followed from passing one
    // `disabled` flag to every button rather than from a decision: the earlier
    // test asserted it but only ever explained where the tooltip lives, never
    // why Project should be unavailable.
    //
    // Without a session, Project is the active scope and the Edits screen is
    // showing its results; a dimmed, dead control for it would read as the
    // screen being broken rather than as one mode being unavailable.
    const onChange = vi.fn();
    const { container } = render(
      <RecentEditsScopeToggle
        value="project"
        onChange={onChange}
        sessionDisabled
      />
    );

    const session = screen.getByRole("radio", { name: "Session" });
    const project = screen.getByRole("radio", { name: "Project" });

    expect(session.hasAttribute("disabled")).toBe(true);
    expect(project.hasAttribute("disabled")).toBe(false);

    fireEvent.click(session);
    expect(onChange).not.toHaveBeenCalled();

    // Project stays usable, which is the whole point of the change.
    fireEvent.click(project);
    expect(onChange).toHaveBeenCalledWith("project");

    // The hint lives on the wrapper, because a disabled button does not
    // reliably fire the events a native tooltip needs.
    expect(
      container.querySelector('[title="Select a session to scope edits to it"]')
    ).toBeTruthy();
  });

  it("disables both buttons when there is no project either", () => {
    // The Edits screen itself shows "select a project" without one, so this is
    // the control's own contract: neither scope resolves without a project,
    // and the hint has to name the project rather than the session - telling
    // someone to pick a session is useless advice before a project is picked.
    const onChange = vi.fn();
    const { container } = render(
      <RecentEditsScopeToggle
        value="project"
        onChange={onChange}
        sessionDisabled
        projectDisabled
      />
    );

    const session = screen.getByRole("radio", { name: "Session" });
    const project = screen.getByRole("radio", { name: "Project" });

    expect(session.hasAttribute("disabled")).toBe(true);
    expect(project.hasAttribute("disabled")).toBe(true);

    fireEvent.click(session);
    fireEvent.click(project);
    expect(onChange).not.toHaveBeenCalled();

    expect(
      container.querySelector('[title="Select a project first"]')
    ).toBeTruthy();
  });
});

describe("RecentEditsDensityToggle", () => {
  it("reflects the selected density through aria-checked", () => {
    render(<RecentEditsDensityToggle value="compact" onChange={() => {}} />);

    expect(
      screen
        .getByRole("radio", { name: "Compact rows" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "Full cards" })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  it("calls onChange with the clicked density", () => {
    const onChange = vi.fn();
    render(<RecentEditsDensityToggle value="compact" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Full cards" }));

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
