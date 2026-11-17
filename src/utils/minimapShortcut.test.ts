import { afterEach, describe, expect, it, vi } from "vitest";
import { getMinimapToggleKeysLabel } from "./minimapShortcut";

describe("getMinimapToggleKeysLabel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Mac glyph label on macOS", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    expect(getMinimapToggleKeysLabel()).toBe("⌘⇧F");
  });

  it("returns the Ctrl label elsewhere", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    expect(getMinimapToggleKeysLabel()).toBe("Ctrl+Shift+F");
  });
});
