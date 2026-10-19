import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SESSION_ROW, sessionItemContentHeight, sessionItemHeight } from "./sessionItemHeight";

const INDEX_CSS = readFileSync(resolve(__dirname, "../../../index.css"), "utf8");

/** px of a type token at 100 % (`--text-<step>: calc(<n>rem * var(--app-font-scale))`). */
function tokenPx(step: string): number {
  const m = new RegExp(`--text-${step}:\\s*calc\\(([\\d.]+)rem \\* var\\(--app-font-scale\\)\\)`).exec(INDEX_CSS);
  if (!m?.[1]) throw new Error(`--text-${step} not found in index.css`);
  return Number(m[1]) * 16;
}

function tokenLineHeight(step: string): number {
  const m = new RegExp(`--text-${step}--line-height:\\s*([\\d.]+);`).exec(INDEX_CSS);
  if (!m?.[1]) throw new Error(`--text-${step}--line-height not found in index.css`);
  return Number(m[1]);
}

describe("sessionItemHeight", () => {
  it("derives from the type tokens the row uses (index.css)", () => {
    expect(SESSION_ROW.name.tokenPx).toBe(tokenPx("list"));
    expect(SESSION_ROW.meta.tokenPx).toBe(tokenPx("caption"));
    expect(SESSION_ROW.meta.lineHeight).toBe(tokenLineHeight("caption"));
  });

  it("is the content height plus the safety margin, rounded up", () => {
    for (const percent of [90, 100, 110, 130]) {
      const content = sessionItemContentHeight(percent / 100);
      expect(sessionItemHeight(percent)).toBe(Math.ceil(content + SESSION_ROW.safety));
      expect(sessionItemHeight(percent) - content).toBeGreaterThanOrEqual(SESSION_ROW.safety);
    }
  });

  it("counts a two-line name and a padded metadata badge (89.05px at 100 %, measured in WebKit)", () => {
    expect(sessionItemContentHeight(1)).toBeCloseTo(89.05, 2);
  });

  it("follows the font scale both ways", () => {
    expect(sessionItemHeight(90)).toBeLessThan(sessionItemHeight(100));
    expect(sessionItemHeight(110)).toBeGreaterThan(sessionItemHeight(100));
    expect(sessionItemHeight(130)).toBeGreaterThan(sessionItemHeight(110));
  });

  it("falls back to the 100 % height for a non-finite scale", () => {
    expect(sessionItemHeight(Number.NaN)).toBe(sessionItemHeight(100));
  });
});
