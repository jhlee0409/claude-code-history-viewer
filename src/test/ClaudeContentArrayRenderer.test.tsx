import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

describe("ClaudeContentArrayRenderer - Markdown Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render text content", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[{ type: "text", text: "Hello world" }]}
      />
    );

    expect(container.textContent).toContain("Hello world");
  });

  it("should render markdown table as <table> element", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[
          {
            type: "text",
            text: "| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |",
          },
        ]}
      />
    );

    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("th").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("should render inline formatting (bold, italic)", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[{ type: "text", text: "**bold** and *italic*" }]}
      />
    );

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("should render GFM extensions (strikethrough)", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[{ type: "text", text: "~~deleted~~ text" }]}
      />
    );

    expect(container.querySelector("del")?.textContent).toBe("deleted");
  });

  it("should render code blocks and lists", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[
          {
            type: "text",
            text: "```js\nconst x = 1;\n```\n\n- item 1\n- item 2\n- item 3",
          },
        ]}
      />
    );

    expect(container.querySelector("code")).toBeTruthy();
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
  });

  it("should use HighlightedText instead of Markdown when searchQuery is provided", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[{ type: "text", text: "**bold** and *italic* text" }]}
        searchQuery="bold"
      />
    );

    // Search mode: should NOT render markdown elements
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("em")).toBeNull();
    // Should contain the raw text with search term
    expect(container.textContent).toContain("bold");
  });

  it("should hide text when skipText is true", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer
        content={[{ type: "text", text: "Hidden" }]}
        skipText={true}
      />
    );

    expect(container.textContent).not.toContain("Hidden");
  });

  it("should return null for empty content array", () => {
    const { container } = render(
      <ClaudeContentArrayRenderer content={[]} />
    );

    expect(container.firstChild).toBeNull();
  });
});
