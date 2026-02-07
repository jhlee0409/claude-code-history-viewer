# Spec: ANSI Color Code Rendering for Terminal Output

> **Issue:** [#109](https://github.com/jhlee0409/claude-code-history-viewer/issues/109)
> **Type:** MAJOR — New utility + component changes across multiple renderers
> **Status:** Draft

---

## Problem

Claude Code commands like `/context` produce terminal output with ANSI escape sequences (colors, bold, italic, etc.). The history viewer displays these as raw escape characters (e.g., `\x1b[38;2;136;136;136m`), making the output unreadable. This affects `CommandOutputDisplay`, `TerminalStreamRenderer`, and any other component rendering raw terminal text.

## Solution

Add an ANSI-to-HTML conversion utility using the [`ansi-to-html`](https://www.npmjs.com/package/ansi-to-html) library, and apply it to all terminal output rendering paths. Text containing ANSI codes gets converted to styled `<span>` elements; text without codes passes through unchanged.

---

## 1. Dependencies

### 1.1 New Package

```bash
npm install ansi-to-html
npm install -D @types/ansi-to-html  # if types exist, otherwise declare module
```

**Why `ansi-to-html`?**
- Lightweight (~4KB), zero dependencies
- Handles SGR codes: bold, italic, underline, 8/16/256/truecolor (RGB)
- XSS-safe with `escapeXML: true` (default)
- Well-maintained, widely used (3M+ weekly downloads)

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
 * Returns true if the string contains ANSI escape sequences.
 */
export function hasAnsiCodes(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[[\d;]*m/.test(text);
}

/**
 * Convert ANSI escape codes to HTML spans with inline styles.
 * Returns the original string if no ANSI codes are present.
 */
export function ansiToHtml(text: string): string {
  if (!hasAnsiCodes(text)) return text;
  return converter.toHtml(text);
}
```

### 2.2 New Component: `src/components/common/AnsiText.tsx`

```tsx
import React, { useMemo } from "react";
import { ansiToHtml, hasAnsiCodes } from "@/utils/ansiToHtml";

interface AnsiTextProps {
  text: string;
  className?: string;
}

/**
 * Renders text with ANSI codes as styled HTML.
 * Falls back to plain text if no ANSI codes detected.
 */
export const AnsiText: React.FC<AnsiTextProps> = ({ text, className }) => {
  const html = useMemo(() => ansiToHtml(text), [text]);
  const containsAnsi = useMemo(() => hasAnsiCodes(text), [text]);

  if (!containsAnsi) {
    return <span className={className}>{text}</span>;
  }

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

Replace the output `<pre>` rendering with `<AnsiText>`:

```tsx
import { AnsiText } from "@/components/common/AnsiText";

// Replace raw output text with:
<pre className={...}>
  <AnsiText text={output} />
</pre>
```

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
import { hasAnsiCodes, ansiToHtml } from "@/utils/ansiToHtml";

describe("ansiToHtml", () => {
  it("detects ANSI codes", () => {
    expect(hasAnsiCodes("\x1b[31mred\x1b[0m")).toBe(true);
    expect(hasAnsiCodes("plain text")).toBe(false);
  });

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

  it("escapes HTML entities", () => {
    const html = ansiToHtml("\x1b[31m<script>alert('xss')</script>\x1b[0m");
    expect(html).not.toContain("<script>");
  });
});
```

### 5.2 Component Tests

Add snapshot tests for `AnsiText` and verify `CommandOutputDisplay` renders colored output correctly.

---

## 6. Performance Considerations

- `hasAnsiCodes()` check is O(n) but short-circuits — avoids unnecessary conversion for plain text
- `ansiToHtml()` result is memoized via `useMemo` in the component
- Single `Convert` instance is reused (module-level singleton)
- No measurable impact on render time for typical command outputs (<10KB)

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
