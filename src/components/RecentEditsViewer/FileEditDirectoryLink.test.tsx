import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

import { FileEditDirectoryLink } from "./FileEditDirectoryLink";

const FULL = "/Users/alex/Projects/my-app/README.md";

describe("FileEditDirectoryLink", () => {
  it("shows a root marker instead of nothing for a file in the project root", () => {
    // R13. `elideProjectRoot` returns "" when the file's directory IS the
    // project root, because nothing is left once the root is removed. Rendered
    // straight through, that was a blank line, and where reveal is available a
    // clickable control with no content and no accessible name.
    render(
      <FileEditDirectoryLink
        directory=""
        fullPath={FULL}
        canReveal={true}
        onReveal={() => {}}
        revealLabel="Show in Explorer"
      />
    );

    const control = screen.getByRole("button");
    expect(control.textContent).toBe(".");
    // "." read aloud is not a location, so the name says it in words.
    expect(control.getAttribute("aria-label")).toBe(
      "Show in Explorer: Project root"
    );
  });

  it("shows the root marker as plain text where reveal is unavailable", () => {
    const { container } = render(
      <FileEditDirectoryLink
        directory=""
        fullPath={FULL}
        canReveal={false}
        onReveal={() => {}}
        revealLabel="Show in Explorer"
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe(".");
  });

  it("leaves an ordinary directory alone", () => {
    render(
      <FileEditDirectoryLink
        directory="src/components"
        fullPath="/Users/alex/Projects/my-app/src/components/App.tsx"
        canReveal={true}
        onReveal={() => {}}
        revealLabel="Show in Explorer"
      />
    );

    const control = screen.getByRole("button");
    expect(control.textContent).toBe("src/components");
    expect(control.getAttribute("aria-label")).toBe(
      "Show in Explorer: src/components"
    );
  });

  it("renders plain text rather than a dead control when reveal is unavailable", () => {
    // The WebUI case: `revealItemInDir` is Tauri-only, and an underlined path
    // that does nothing when clicked is worse than one that never claimed to be
    // clickable.
    render(
      <FileEditDirectoryLink
        directory="src/components"
        fullPath="/Users/alex/Projects/my-app/src/components/App.tsx"
        canReveal={false}
        onReveal={() => {}}
        revealLabel="Show in Explorer"
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("src/components")).toBeTruthy();
  });
});
