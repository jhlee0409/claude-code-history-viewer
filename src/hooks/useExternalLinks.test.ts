import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExternalLinks } from "./useExternalLinks";
import { openExternalUrl } from "@/utils/platform";
import { toast } from "sonner";

vi.mock("@/utils/platform", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("useExternalLinks", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(openExternalUrl).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("intercepts external http links on unmodified left click", async () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.textContent = "external";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
    unmount();
  });

  it("intercepts MAILTO links case-insensitively", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "MAILTO:test@example.com");
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith("MAILTO:test@example.com");
    unmount();
  });

  it("does not intercept internal links", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "#internal-path");
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("does not intercept modified clicks", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.addEventListener("click", (event) => event.preventDefault());
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    anchor.dispatchEvent(event);

    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("does not intercept links with non-self target", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.setAttribute("target", "_blank");
    anchor.addEventListener("click", (event) => event.preventDefault());
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("shows a toast when opening an external link fails", async () => {
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error("open failed"));
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    await Promise.resolve();

    expect(toast.error).toHaveBeenCalledWith("Failed to open link.");
    unmount();
  });
});
