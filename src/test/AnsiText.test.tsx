/**
 * @fileoverview Component tests for AnsiText
 * Tests ANSI rendering, HTML escaping, and XSS safety
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnsiText } from "@/components/common/AnsiText";

describe("AnsiText Component", () => {
  describe("ANSI code rendering", () => {
    it("renders text content from ANSI-coded input", () => {
      const { container } = render(
        <AnsiText text="\x1b[31mred text\x1b[0m" />
      );
      
      const span = container.querySelector("span");
      expect(span).toBeInTheDocument();
      
      // Verify the text content is extracted correctly
      expect(span?.textContent).toContain("red text");
      // Verify ANSI codes were processed (either converted to HTML or stripped)
      expect(span?.textContent).not.toContain("\x1b[");
    });

    it("renders text content from RGB truecolor codes", () => {
      const { container } = render(
        <AnsiText text="\x1b[38;2;136;136;136mgray text\x1b[0m" />
      );
      
      const span = container.querySelector("span");
      expect(span?.textContent).toContain("gray text");
      expect(span?.textContent).not.toContain("\x1b[");
    });

    it("renders text content from multiple color sequences", () => {
      const { container } = render(
        <AnsiText text="\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m" />
      );
      
      const span = container.querySelector("span");
      expect(span?.textContent).toContain("red");
      expect(span?.textContent).toContain("green");
      expect(span?.textContent).not.toContain("\x1b[");
    });
  });

  describe("HTML escaping and XSS safety", () => {
    it("escapes HTML entities in ANSI-coded text", () => {
      const { container } = render(
        <AnsiText text="\x1b[31m<script>alert('xss')</script>\x1b[0m" />
      );
      
      const innerHTML = container.querySelector("span")?.innerHTML || "";
      // HTML should be escaped - no actual script tags in the DOM
      expect(innerHTML).not.toContain("<script>");
      expect(innerHTML).toContain("&lt;script&gt;");
      
      // Verify no script elements were actually created
      expect(container.querySelector("script")).toBeNull();
    });

    it("escapes HTML entities in plain text without ANSI codes", () => {
      const { container } = render(
        <AnsiText text="<script>alert('xss')</script>" />
      );
      
      const innerHTML = container.querySelector("span")?.innerHTML || "";
      // Even plain text should be HTML-escaped for XSS safety
      expect(innerHTML).not.toContain("<script>");
      expect(innerHTML).toContain("&lt;script&gt;");
      
      // Verify no script elements were actually created
      expect(container.querySelector("script")).toBeNull();
    });

    it("escapes other dangerous HTML tags", () => {
      const { container } = render(
        <AnsiText text="<img src=x onerror=alert('xss')>" />
      );
      
      const innerHTML = container.querySelector("span")?.innerHTML || "";
      expect(innerHTML).toContain("&lt;img");
      expect(innerHTML).toContain("&gt;");
      
      // Verify no img elements were actually created
      expect(container.querySelector("img")).toBeNull();
    });

    it("escapes HTML in mixed ANSI and plain text", () => {
      const { container } = render(
        <AnsiText text="\x1b[31m<b>bold?</b>\x1b[0m normal <em>italic?</em>" />
      );
      
      const innerHTML = container.querySelector("span")?.innerHTML || "";
      // Both HTML tags should be escaped
      expect(innerHTML).toContain("&lt;b&gt;");
      expect(innerHTML).toContain("&lt;em&gt;");
      
      // Verify no b or em elements were created from the text
      expect(container.querySelector("b")).toBeNull();
      expect(container.querySelector("em")).toBeNull();
    });
  });

  describe("plain text rendering", () => {
    it("renders plain text without ANSI codes", () => {
      const { container } = render(
        <AnsiText text="plain text without any codes" />
      );
      
      const span = container.querySelector("span");
      expect(span).toBeInTheDocument();
      expect(span?.textContent).toBe("plain text without any codes");
    });

    it("preserves special characters in plain text", () => {
      const { container } = render(
        <AnsiText text={'Special chars: & < > " \''} />
      );
      
      const span = container.querySelector("span");
      const innerHTML = span?.innerHTML || "";
      // Special characters should be HTML-escaped
      expect(innerHTML).toContain("&amp;");
      expect(innerHTML).toContain("&lt;");
      expect(innerHTML).toContain("&gt;");
      // Quotes might not be escaped as &quot; in attribute context, so just verify they're safe
      expect(span?.textContent).toContain('"');
      expect(span?.textContent).toContain("'");
    });
  });

  describe("className prop", () => {
    it("applies custom className to the span element", () => {
      const { container } = render(
        <AnsiText text="test" className="custom-class text-red-500" />
      );

      const span = container.querySelector("span");
      expect(span).toHaveClass("custom-class");
      expect(span).toHaveClass("text-red-500");
    });
  });

  describe("URL linkification", () => {
    it("renders clickable links for https URLs", () => {
      const { container } = render(
        <AnsiText text="Visit https://github.com/user/repo for details" />
      );

      const link = container.querySelector("a.ansi-url");
      expect(link).toBeInTheDocument();
      expect(link?.getAttribute("href")).toBe("https://github.com/user/repo");
      expect(link?.textContent).toBe("https://github.com/user/repo");
    });

    it("renders clickable links inside ANSI-styled text", () => {
      const { container } = render(
        <AnsiText text="\x1b[34mhttps://example.com/path\x1b[0m" />
      );

      const link = container.querySelector("a.ansi-url");
      expect(link).toBeInTheDocument();
      // Verify the link href starts with the expected URL
      const href = link?.getAttribute("href") ?? "";
      expect(href).toMatch(/^https:\/\/example\.com\/path/);
    });

    it("does not create links for javascript: protocol", () => {
      const { container } = render(
        <AnsiText text="javascript:alert(1)" />
      );

      expect(container.querySelector("a")).toBeNull();
    });

    it("renders multiple links in one text", () => {
      const { container } = render(
        <AnsiText text="See https://a.com and https://b.com" />
      );

      const links = container.querySelectorAll("a.ansi-url");
      expect(links).toHaveLength(2);
      expect(links[0]?.getAttribute("href")).toBe("https://a.com");
      expect(links[1]?.getAttribute("href")).toBe("https://b.com");
    });

    it("excludes trailing punctuation from link", () => {
      const { container } = render(
        <AnsiText text="Check https://example.com." />
      );

      const link = container.querySelector("a.ansi-url");
      expect(link?.getAttribute("href")).toBe("https://example.com");
      // The period should not be inside the link
      expect(link?.textContent).toBe("https://example.com");
    });
  });
});
