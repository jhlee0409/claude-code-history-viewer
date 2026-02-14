# Spec: ANSI Color Code Rendering for Terminal Output

> **Issue:** [#109](https://github.com/jhlee0409/claude-code-history-viewer/issues/109)
> **Type:** MAJOR — New utility + component changes across multiple renderers
> **Status:** ✅ Implemented (see PR #111)

---

## Problem

Claude Code commands like `/context` produce terminal output with ANSI escape sequences (colors, bold, italic, etc.). The history viewer displays these as raw escape characters (e.g., `\x1b[38;2;136;136;136m`), making the output unreadable. This affects `CommandOutputDisplay`, `TerminalStreamRenderer`, and any other component rendering raw terminal text.

## Solution

Add an ANSI-to-HTML conversion utility using the [`ansi-to-html`](https://www.npmjs.com/package/ansi-to-html) library, and apply it to all terminal output rendering paths. Text containing ANSI codes gets converted to styled `<span>` elements; text without codes passes through unchanged.

---

## 1. Dependencies

### 1.1 New Package

```bash
pnpm add ansi-to-html
pnpm add -D @types/ansi-to-html  # Not available; see type declaration below
```

**Why `ansi-to-html`?**
- Lightweight (~4KB)
- Single dependency (`entities` for HTML entity encoding)
- Handles SGR codes: bold, italic, underline, 8/16/256/truecolor (RGB)
- XSS-safe with `escapeXML: true` (default)
- Well-maintained, widely used (3M+ weekly downloads)

**Type Declaration:**

Since `@types/ansi-to-html` is not available, add a type declaration file:

**`src/types/ansi-to-html.d.ts`:**
```typescript
declare module "ansi-to-html" {
  interface ConstructorOptions {
    fg?: string;
    bg?: string;
    newline?: boolean;
    escapeXML?: boolean;
    stream?: boolean;
    colors?: string[] | Record<string, string>;
  }

  export default class Convert {
    constructor(options?: ConstructorOptions);
    toHtml(input: string): string;
  }
}
```

**Alternatives considered:**
- `anser` — similar but less actively maintained
- `xterm.js` — overkill (full terminal emulator), heavy bundle impact
- Manual regex — fragile, doesn't handle full SGR spec

---

## 2. Utility: `ansiToHtml`

### 2.1 New File: `src/utils/ansiToHtml.ts`

```typescript
import Convert from "ansi-to-html";

const converter = new Convert({
  fg: "var(--foreground)",       // respect theme
  bg: "transparent",
  escapeXML: true,               // XSS protection
  newline: false,                 // we handle newlines via <pre>
});

/**
 * Regex pattern for detecting ANSI SGR (Select Graphic Rendition) sequences.
 * 
 * Note: This pattern only matches SGR sequences ending with 'm' (color/style codes).
 * It does not match other ANSI escape sequences like cursor movement, screen clearing,
 * or other CSI sequences. This is sufficient for Claude Code's terminal output.
 */
const ANSI_REGEX = /\x1b\[[\d;]*m/;

/**
 * Returns true if the string contains ANSI SGR escape sequences.
 */
export function hasAnsiCodes(text: string): boolean {
  return ANSI_REGEX.test(text);
}

/**
 * Strip ANSI SGR escape codes from a string, returning plain text.
 * Uses global flag for replacement to remove all occurrences.
 */
export function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[\d;]*m/g, "");
}

/**
 * Convert ANSI escape codes to HTML spans with inline styles.
 * Always returns HTML-safe output (non-ANSI text is HTML-escaped via escapeXML: true).
 */
export function ansiToHtml(text: string): string {
  return converter.toHtml(text);
}
```

### 2.2 New Component: `src/components/common/AnsiText.tsx`

```tsx
import { useMemo } from "react";
import { ansiToHtml } from "@/utils/ansiToHtml";

interface AnsiTextProps {
  text: string;
  className?: string;
}

/**
 * Renders text with ANSI codes as styled HTML.
 * Always escapes HTML entities for XSS safety.
 * 
 * Note: ansiToHtml() always returns HTML-safe output via the converter's
 * escapeXML: true setting. This escaping happens even for plain text without
 * ANSI codes, which is why dangerouslySetInnerHTML is safe to use here
 * unconditionally.
 */
export const AnsiText = ({ text, className }: AnsiTextProps) => {
  const html = useMemo(() => ansiToHtml(text), [text]);

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
```

---

## 3. Component Changes

### 3.1 `CommandOutputDisplay.tsx`

Replace all `<pre>...{stdout}</pre>` blocks with:

```tsx
import { AnsiText } from "@/components/common/AnsiText";

// In each render branch, replace:
<pre className={cn(layout.monoText, "text-foreground/80 whitespace-pre-wrap p-3")}>
  {stdout}
</pre>

// With:
<pre className={cn(layout.monoText, "text-foreground/80 whitespace-pre-wrap p-3")}>
  <AnsiText text={stdout} />
</pre>
```

**Affected branches:** default terminal, test output, build output, package output, table output (5 total `<pre>` blocks).

### 3.2 `TerminalStreamRenderer.tsx`

Replace the output `<pre>` rendering with conditional ANSI handling:

```tsx
import { AnsiText } from "@/components/common/AnsiText";
import { stripAnsiCodes } from "@/utils/ansiToHtml";
import { HighlightedText } from "@/components/common/HighlightedText";

type TerminalStreamRendererProps = {
  output: string;
  searchQuery?: string;
};

export function TerminalStreamRenderer({
  output,
  searchQuery,
}: TerminalStreamRendererProps) {
  return (
    <pre className={cn(layout.monoText, "text-foreground whitespace-pre-wrap bg-muted p-2 rounded")}>
      {searchQuery ? (
        // Strip ANSI codes before highlighting to prevent escape sequences
        // from interfering with search highlighting
        <HighlightedText
          text={stripAnsiCodes(output)}
          searchQuery={searchQuery}
        />
      ) : (
        // Render with ANSI colors/styles when not searching
        <AnsiText text={output} />
      )}
    </pre>
  );
}
```

**Key Pattern:** When `searchQuery` is present, use `stripAnsiCodes()` before `HighlightedText` to prevent raw ANSI escape sequences from appearing in search results. When not searching, use `AnsiText` to preserve terminal colors and styles.

### 3.3 `toolResultRenderer/StringRenderer.tsx`

Check if this renders tool result strings — if so, apply `AnsiText` to the text content as well.

### 3.4 `contentRenderer/CommandRenderer.tsx`

If this component renders command stdout/stderr directly, wrap with `AnsiText`.

---

## 4. Theme Integration

ANSI true-color (RGB) values are used as-is since they come from the terminal. For the 16 standard ANSI colors, `ansi-to-html` maps them to default values which work well on dark backgrounds. For light mode compatibility:

- The converter uses CSS variables for default fg/bg
- Explicit RGB colors from Claude Code (like `\x1b[38;2;136;136;136m`) render correctly in both themes
- Standard colors (red, green, yellow, etc.) from the library's defaults are readable in both modes

No additional theme work is needed for the initial implementation.

---

## 5. Testing

### 5.1 Unit Tests: `src/test/ansiToHtml.test.ts`

```typescript
import { hasAnsiCodes, stripAnsiCodes, ansiToHtml } from "@/utils/ansiToHtml";

describe("hasAnsiCodes", () => {
  it("detects ANSI codes", () => {
    expect(hasAnsiCodes("\x1b[31mred\x1b[0m")).toBe(true);
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

  it("preserves text content including special characters", () => {
    expect(stripAnsiCodes("\x1b[31m<script>alert('test')</script>\x1b[0m"))
      .toBe("<script>alert('test')</script>");
  });
});

describe("ansiToHtml", () => {
  it("converts basic colors", () => {
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
```

### 5.2 Component Tests

Add snapshot tests for `AnsiText` and verify `CommandOutputDisplay` renders colored output correctly.

---

## 6. Performance Considerations

- The `ansiToHtml()` function always processes text through the converter to ensure HTML escaping (via `escapeXML: true`), even for plain text without ANSI codes. This is intentional for XSS safety.
- The conversion overhead is negligible for typical command outputs (<10KB). The `ansi-to-html` library is optimized for performance.
- `ansiToHtml()` result is memoized via `useMemo` in the `AnsiText` component to avoid redundant conversions on re-renders.
- Single `Convert` instance is reused (module-level singleton) to avoid repeated initialization.
- `stripAnsiCodes()` uses a simple regex replacement with no conversion overhead — optimal for search functionality where ANSI styling is not needed.

---

## 7. Migration Path

This is purely additive — no breaking changes. Components that previously rendered raw ANSI text now render styled HTML. Plain text (no ANSI codes) is completely unaffected.

---

## 8. Files Changed (Summary)

| File | Change |
|------|--------|
| `package.json` | Add `ansi-to-html` dependency |
| `src/utils/ansiToHtml.ts` | **New** — conversion utility |
| `src/components/common/AnsiText.tsx` | **New** — reusable component |
| `src/components/messageRenderer/CommandOutputDisplay.tsx` | Use `AnsiText` in `<pre>` blocks |
| `src/components/toolResultRenderer/TerminalStreamRenderer.tsx` | Use `AnsiText` for output |
| `src/components/contentRenderer/CommandRenderer.tsx` | Use `AnsiText` if applicable |
| `src/test/ansiToHtml.test.ts` | **New** — unit tests |

**Estimated effort:** Small-Medium (1-2 hours implementation, mostly mechanical replacement)
