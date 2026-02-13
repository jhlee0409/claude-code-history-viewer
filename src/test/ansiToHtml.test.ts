import { describe, it, expect } from "vitest";
import { hasAnsiCodes, ansiToHtml, stripAnsiCodes } from "@/utils/ansiToHtml";

describe("hasAnsiCodes", () => {
  it("detects ANSI color codes", () => {
    expect(hasAnsiCodes("\x1b[31mred\x1b[0m")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(hasAnsiCodes("plain text")).toBe(false);
  });

  it("detects RGB truecolor codes", () => {
    expect(hasAnsiCodes("\x1b[38;2;136;136;136mgray\x1b[0m")).toBe(true);
  });
});

describe("stripAnsiCodes", () => {
  it("strips ANSI color codes from text", () => {
    expect(stripAnsiCodes("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  it("handles RGB truecolor codes", () => {
    expect(stripAnsiCodes("\x1b[38;2;136;136;136mgray\x1b[0m")).toBe("gray");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsiCodes("plain text")).toBe("plain text");
  });

  it("strips multiple color sequences", () => {
    expect(stripAnsiCodes("\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m")).toBe("red green");
  });

  it("preserves text content and special characters", () => {
    expect(stripAnsiCodes("\x1b[31m<script>alert('test')</script>\x1b[0m")).toBe("<script>alert('test')</script>");
  });
});

describe("ansiToHtml", () => {
  it("converts basic colors to HTML", () => {
    const html = ansiToHtml("\x1b[31mred text\x1b[0m");
    expect(html).toContain("color:");
    expect(html).toContain("red text");
  });

  it("handles RGB truecolor", () => {
    const html = ansiToHtml("\x1b[38;2;136;136;136mgray\x1b[0m");
    expect(html).toContain("color:");
    expect(html).toContain("gray");
  });

  it("passes through plain text unchanged", () => {
    expect(ansiToHtml("hello world")).toBe("hello world");
  });

  it("escapes HTML entities for XSS prevention", () => {
    const html = ansiToHtml("\x1b[31m<script>alert('xss')</script>\x1b[0m");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML entities without ANSI codes", () => {
    const html = ansiToHtml("<script>alert('xss')</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles multiple color sequences", () => {
    const html = ansiToHtml("\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m");
    expect(html).toContain("red");
    expect(html).toContain("green");
  });
});
