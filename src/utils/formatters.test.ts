import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatters";

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("handles negative values", () => {
    expect(formatBytes(-1024)).toBe("-1.0 KB");
  });

  it("clamps units for very large values", () => {
    const formatted = formatBytes(1024 ** 6);
    expect(formatted).toContain("TB");
    expect(formatted).not.toContain("undefined");
  });
});
