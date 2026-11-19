/**
 * The current search mark stays visible on the current-match message (#736).
 *
 * A current-match message is painted `--highlight-current`, the same colour as
 * the current mark's background and ring, and the mark's text colour is about
 * the row's own (1.0–1.2:1 against `--fg`). Where the mark sits on the
 * message's own background, a tool row's head (Task #n, a command, a path),
 * nothing but a non-background indicator can tell it apart: its underline,
 * in a colour ≥3:1 (WCAG 1.4.11) against that background in every theme.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchMarkCurrentClass } from "@/components/common/HighlightedText";
import { THEME_NAMES, contrast, createTokenResolver } from "./utils/oklchContrast";

const NON_TEXT = 3;
const tokens = createTokenResolver();
const classes = searchMarkCurrentClass.split(/\s+/);

/** The background ClaudeMessageNode paints a current-match message with (every message kind). */
function currentMessageBackground(): string {
  const source = fs.readFileSync(path.resolve(__dirname, "../components/MessageViewer/components/ClaudeMessageNode.tsx"), "utf8");
  const found = [...source.matchAll(/(?<!!)isCurrentMatch && "bg-([\w-]+)/g)].map((m) => m[1]!);
  expect(found.length, "ClaudeMessageNode paints current-match messages").toBeGreaterThan(0);
  expect(new Set(found).size, `one current-match background: ${found.join(", ")}`).toBe(1);
  return found[0]!;
}

/** The token a Tailwind colour utility with `prefix` names, e.g. `bg-highlight` → `highlight`. */
function colorToken(prefix: string): string | undefined {
  return classes.find((c) => c.startsWith(`${prefix}-`) && !/^\d/.test(c.slice(prefix.length + 1)))?.slice(prefix.length + 1);
}

describe("current search mark on a current-match message (#736)", () => {
  const messageBg = currentMessageBackground();

  it("shares the message's background, so the background alone cannot tell it apart", () => {
    // The premise of the indicator below; if this changes, revisit it.
    expect(colorToken("bg")).toBe(messageBg);
  });

  it("is underlined, 2px thick", () => {
    expect(classes).toContain("underline");
    expect(classes).toContain("decoration-2");
  });

  describe.each(THEME_NAMES)("%s theme", (theme) => {
    it(`the underline stands out from the message background (${NON_TEXT}:1)`, () => {
      // An underline is drawn in its decoration colour, else in the text colour.
      const line = classes.includes("underline") ? (colorToken("decoration") ?? colorToken("text")) : undefined;
      expect(line, "the mark is underlined").toBeDefined();
      const r = contrast(tokens.color(theme, line!), tokens.color(theme, messageBg));
      expect(r, `${theme}: --${line} on --${messageBg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT);
    });
  });
});
