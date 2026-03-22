import { describe, it, expect } from "vitest";
import { hasAnsiCodes, ansiToHtml, stripAnsiCodes, linkifyUrls } from "@/utils/ansiToHtml";

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

  it("passes through plain text without URLs unchanged", () => {
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

  it("linkifies https URLs in output", () => {
    const result = ansiToHtml("Visit https://example.com for more");
    expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>');
  });

  it("linkifies URLs inside ANSI-styled text", () => {
    const result = ansiToHtml("\x1b[34mhttps://github.com/user/repo\x1b[0m");
    expect(result).toContain('<a href="https://github.com/user/repo"');
    expect(result).toContain("<span");
  });

  it("does not linkify dangerous protocols", () => {
    const result = ansiToHtml("javascript:alert(1)");
    expect(result).not.toContain("<a ");
  });

  it("escapes HTML but still linkifies URLs", () => {
    const result = ansiToHtml("<script>alert('xss')</script> https://example.com");
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain('<a href="https://example.com"');
  });
});

describe("linkifyUrls", () => {
  describe("basic URL linkification", () => {
    it("linkifies https URLs", () => {
      const result = linkifyUrls("Visit https://example.com for info");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>');
    });

    it("linkifies http URLs", () => {
      const result = linkifyUrls("See http://example.com/page");
      expect(result).toContain('<a href="http://example.com/page" class="ansi-url">http://example.com/page</a>');
    });

    it("linkifies mailto URLs", () => {
      const result = linkifyUrls("Email mailto:user@example.com");
      expect(result).toContain('<a href="mailto:user@example.com" class="ansi-url">mailto:user@example.com</a>');
    });

    it("linkifies multiple URLs in one string", () => {
      const result = linkifyUrls("See https://a.com and https://b.com");
      expect(result).toContain('<a href="https://a.com"');
      expect(result).toContain('<a href="https://b.com"');
    });

    it("linkifies URLs with paths and query params", () => {
      const result = linkifyUrls("PR at https://github.com/user/repo/pull/123?tab=files");
      expect(result).toContain('<a href="https://github.com/user/repo/pull/123?tab=files"');
    });

    it("linkifies URLs with hash fragments", () => {
      const result = linkifyUrls("See https://docs.rs/crate#section-1");
      expect(result).toContain('<a href="https://docs.rs/crate#section-1"');
    });
  });

  describe("URL boundary detection", () => {
    it("excludes trailing period", () => {
      const result = linkifyUrls("Visit https://example.com.");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>.');
    });

    it("excludes trailing comma", () => {
      const result = linkifyUrls("See https://example.com, then continue");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>,');
    });

    it("excludes unbalanced trailing parenthesis", () => {
      const result = linkifyUrls("(see https://example.com)");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>)');
    });

    it("preserves balanced parens in Wikipedia-style URLs", () => {
      const result = linkifyUrls("https://en.wikipedia.org/wiki/Rust_(programming_language)");
      expect(result).toContain(
        '<a href="https://en.wikipedia.org/wiki/Rust_(programming_language)" class="ansi-url">https://en.wikipedia.org/wiki/Rust_(programming_language)</a>'
      );
    });

    it("trims only excess trailing parens from URL with balanced inner parens", () => {
      const result = linkifyUrls("(see https://en.wikipedia.org/wiki/Rust_(lang))");
      expect(result).toContain(
        '<a href="https://en.wikipedia.org/wiki/Rust_(lang)" class="ansi-url">https://en.wikipedia.org/wiki/Rust_(lang)</a>)'
      );
    });

    it("excludes trailing exclamation mark", () => {
      const result = linkifyUrls("Check https://example.com!");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>!');
    });
  });

  describe("HTML tag skipping", () => {
    it("does not linkify URLs inside HTML tag attributes", () => {
      const html = '<span style="color:rgb(0,0,0)">text</span>';
      expect(linkifyUrls(html)).toBe(html);
    });

    it("linkifies URL in text content but skips HTML tags", () => {
      const html = '<span style="color:red">https://example.com</span>';
      const result = linkifyUrls(html);
      expect(result).toContain('<span style="color:red">');
      expect(result).toContain('<a href="https://example.com"');
    });
  });

  describe("dangerous protocol rejection", () => {
    it("does not linkify javascript: URLs", () => {
      expect(linkifyUrls("javascript:alert(1)")).toBe("javascript:alert(1)");
    });

    it("does not linkify data: URLs", () => {
      expect(linkifyUrls("data:text/html,test")).not.toContain("<a ");
    });

    it("does not linkify file: URLs", () => {
      expect(linkifyUrls("file:///etc/passwd")).not.toContain("<a ");
    });
  });

  describe("edge cases", () => {
    it("returns empty string unchanged", () => {
      expect(linkifyUrls("")).toBe("");
    });

    it("returns plain text without URLs unchanged", () => {
      expect(linkifyUrls("just plain text")).toBe("just plain text");
    });

    it("returns HTML without URLs unchanged", () => {
      const html = '<span style="color:red">error</span>';
      expect(linkifyUrls(html)).toBe(html);
    });

    it("adds ansi-url class to generated links", () => {
      expect(linkifyUrls("https://example.com")).toContain('class="ansi-url"');
    });

    it("produces well-formed href without attribute breakout", () => {
      const result = linkifyUrls("https://example.com/path");
      const hrefMatch = result.match(/href="([^"]*)"/);
      expect(hrefMatch).not.toBeNull();
      expect(hrefMatch?.[1]).toBe("https://example.com/path");
    });

    it("linkifies minimal single-char URL after scheme", () => {
      const result = linkifyUrls("https://x");
      expect(result).toContain('<a href="https://x" class="ansi-url">https://x</a>');
    });
  });

  describe("HTML entity tail stripping", () => {
    it("strips trailing &quot from URL", () => {
      // After escapeXML: https://example.com&quot; (from original https://example.com")
      const result = linkifyUrls("https://example.com&quot;rest");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>');
      expect(result).toContain("&quot;rest");
    });

    it("strips trailing &lt from URL", () => {
      const result = linkifyUrls("https://example.com&lt;tag");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>');
      expect(result).toContain("&lt;tag");
    });

    it("strips trailing &amp from URL", () => {
      const result = linkifyUrls("https://example.com&amp;");
      expect(result).toContain('<a href="https://example.com" class="ansi-url">https://example.com</a>');
    });

    it("preserves &amp; in the middle of URL query params", () => {
      const result = linkifyUrls("https://example.com?a=1&amp;b=2");
      expect(result).toContain('href="https://example.com?a=1&amp;b=2"');
    });
  });
});
