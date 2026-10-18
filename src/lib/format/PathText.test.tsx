import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PathText } from "./PathText";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const root = (container: HTMLElement) => container.querySelector("[data-path]") as HTMLElement;

describe("PathText", () => {
  it("shows the shortened path and keeps the full one in title and data-path", () => {
    const { container } = render(
      <PathText path="/Users/jack/client/app/src/a.ts" ctx={{ projectRoot: "/Users/jack/client/app" }} />,
    );
    const el = root(container);
    expect(el.textContent).toBe("src/a.ts");
    expect(el).toHaveAttribute("data-path", "/Users/jack/client/app/src/a.ts");
    expect(el).toHaveAttribute("data-path-kind", "project");
    expect(el).toHaveAttribute("title", "/Users/jack/client/app/src/a.ts");
    expect(el).toHaveAttribute("data-mono", "path");
  });

  it("ellipsises only the folder part and never the file name", () => {
    const { container } = render(<PathText path="/opt/some/deep/folder/file-name.json" />);
    const dir = container.querySelector('[data-path-part="dir"]');
    const name = container.querySelector('[data-path-part="name"]');
    expect(root(container)).toHaveAttribute("data-path-kind", "absolute");
    expect(dir?.textContent).toBe("/opt/some/deep/folder/");
    expect(dir?.className).toContain("truncate");
    expect(name?.textContent).toBe("file-name.json");
    expect(name?.className).not.toContain("truncate");
    expect(name?.className).toContain("break-all");
  });

  it("renders no folder part for a bare name", () => {
    const { container } = render(<PathText path="/p/README.md" ctx={{ projectRoot: "/p" }} />);
    expect(container.querySelector('[data-path-part="dir"]')).toBeNull();
    expect(root(container).textContent).toBe("README.md");
  });

  it("copies the full path when the whole text is selected", () => {
    const { container } = render(<PathText path="/home/me/proj/a.ts" ctx={{ homeDir: "/home/me" }} />);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "~/proj/\na.ts" } as Selection);
    const setData = vi.fn();
    const event = fireEvent.copy(root(container), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "/home/me/proj/a.ts");
    expect(event).toBe(false); // default prevented
  });

  it("leaves a partial selection alone", () => {
    const { container } = render(<PathText path="/home/me/proj/a.ts" ctx={{ homeDir: "/home/me" }} />);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "proj" } as Selection);
    const setData = vi.fn();
    const event = fireEvent.copy(root(container), { clipboardData: { setData } });
    expect(setData).not.toHaveBeenCalled();
    expect(event).toBe(true);
  });
});
