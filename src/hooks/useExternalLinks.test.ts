import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExternalLinks } from "./useExternalLinks";
import { openExternalUrl } from "@/utils/platform";
import { toast } from "sonner";

vi.mock("@/utils/platform", () => ({
  EXTERNAL_OPEN_HELPER_ATTRIBUTE: "data-external-open-helper",
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

  it.each(["src/App.tsx#L42", "./README.md", "/etc/hosts", "file:///C:/repo/a.ts"])(
    "blocks in-app navigation for non-external link %s",
    (href) => {
      const { unmount } = renderHook(() => useExternalLinks());
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      document.body.appendChild(anchor);

      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      anchor.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(openExternalUrl).not.toHaveBeenCalled();
      unmount();
    }
  );

  it("does not block programmatic blob downloads", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "blob:tauri://localhost/1234");
    anchor.download = "export.json";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("does not block programmatic data: downloads", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "data:image/png;base64,AAAA");
    anchor.download = "claude-image.png";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });

  it.each(["data:text/html,<h1>phish</h1>", "blob:tauri://localhost/1234"])(
    "blocks in-app navigation for %s without a download attribute",
    (href) => {
      const { unmount } = renderHook(() => useExternalLinks());
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      document.body.appendChild(anchor);

      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      anchor.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(openExternalUrl).not.toHaveBeenCalled();
      unmount();
    }
  );

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

  it("intercepts links with _blank target", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.setAttribute("target", "_blank");
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
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

  it("ignores helper anchors created by the browser fallback", () => {
    const { unmount } = renderHook(() => useExternalLinks());
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.setAttribute("data-external-open-helper", "true");
    anchor.addEventListener("click", (event) => event.preventDefault());
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });
});
