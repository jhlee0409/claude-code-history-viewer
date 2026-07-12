import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TruncatedPre } from "./TruncatedPre";
import {
  PLAIN_PREVIEW_CHARS,
  HIGHLIGHT_MAX_CHARS,
  isTooLargeToHighlight,
  formatCharSize,
} from "../../utils/contentSizeGuard";

describe("TruncatedPre", () => {
  it("renders small content untouched, without a show-all control", () => {
    render(<TruncatedPre content="hello world" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("truncates oversized content and reveals it all on demand", () => {
    const big = "x".repeat(PLAIN_PREVIEW_CHARS + 1000);
    const { container } = render(<TruncatedPre content={big} />);

    const pre = container.querySelector("pre");
    expect(pre?.textContent).toHaveLength(PLAIN_PREVIEW_CHARS);

    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector("pre")?.textContent).toHaveLength(
      big.length,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("contentSizeGuard", () => {
  it("flags content above the highlight threshold", () => {
    expect(isTooLargeToHighlight("x".repeat(HIGHLIGHT_MAX_CHARS))).toBe(false);
    expect(isTooLargeToHighlight("x".repeat(HIGHLIGHT_MAX_CHARS + 1))).toBe(
      true,
    );
  });

  it("formats char sizes readably", () => {
    expect(formatCharSize(10)).toBe("10 chars");
    expect(formatCharSize(4 * 1024)).toBe("4.0 KB");
    expect(formatCharSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
