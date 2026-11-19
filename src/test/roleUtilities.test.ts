import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLOR_ROLES } from "./utils/roleTokens";

/**
 * The F1a role tokens are real Tailwind utilities: compile src/index.css with
 * Tailwind (no source scanning, only the listed classes) and read the rules
 * each utility produces. The tokens are not used by any screen yet, so this
 * is the proof that a later PR can write `rounded-row` or `shadow-popover`
 * and get the token, not an empty class.
 */

const SRC = path.resolve(__dirname, "..");

const UTILITIES: ReadonlyArray<readonly [cls: string, declaration: RegExp]> = [
  ["rounded-row", /border-radius:\s*var\(--radius-row\)/],
  ["rounded-control", /border-radius:\s*var\(--radius-control\)/],
  ["rounded-overlay", /border-radius:\s*var\(--radius-overlay\)/],
  ["rounded-pill", /border-radius:\s*var\(--radius-pill\)/],
  ["rounded-dot", /border-radius:\s*var\(--radius-dot\)/],
  ["shadow-popover", /--tw-shadow:\s*var\(--elevation-popover\)/],
  ["shadow-overlay", /--tw-shadow:\s*var\(--elevation-overlay\)/],
  ["duration-fast", /transition-duration:\s*var\(--duration-fast\)/],
  ["duration-normal", /transition-duration:\s*var\(--duration-normal\)/],
  ["duration-slow", /transition-duration:\s*var\(--duration-slow\)/],
  ["ease-standard", /transition-timing-function:\s*var\(--ease-standard\)/],
  ["ease-emphasized", /transition-timing-function:\s*var\(--ease-emphasized\)/],
  ["transition-colors", /transition-duration:\s*var\(--tw-duration,\s*var\(--duration-fast\)\)/],
  ["px-page-inset", /padding-inline:\s*var\(--page-inset\)/],
  ["min-h-row-tool", /min-height:\s*var\(--row-tool\)/],
  ["min-h-row-list", /min-height:\s*var\(--row-list\)/],
  ["min-h-row-file", /min-height:\s*var\(--row-file\)/],
  ["min-h-row-touch", /min-height:\s*var\(--row-touch\)/],
  ["w-rail", /width:\s*var\(--rail-width\)/],
  ["max-w-measure-prose", /max-width:\s*var\(--measure-prose\)/],
  ["max-w-measure-work", /max-width:\s*var\(--measure-work\)/],
  ["text-fg-3", /color:\s*var\(--fg-3\)/],
  ["bg-surface-well", /background-color:\s*var\(--surface-well\)/],
  ["border-line-input", /border-color:\s*var\(--line-input\)/],
  ["outline-focus-ring", /outline-color:\s*var\(--focus-ring\)/],
  ["bg-diff-word-add-bg", /background-color:\s*var\(--diff-word-add-bg\)/],
  ["text-status-danger-fg", /color:\s*var\(--status-danger-fg\)/],
];

let css = "";
let emptyBase = "";

/** The declarations of `.cls { … }` in the compiled CSS. */
function rule(cls: string): string {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1] ?? "";
}

beforeAll(async () => {
  emptyBase = fs.mkdtempSync(path.join(os.tmpdir(), "cchv-role-utilities-"));
  const classes = [...UTILITIES.map(([cls]) => cls), ...COLOR_ROLES.map((role) => `bg-${role}`)];
  const input = `@import ${JSON.stringify(path.join(SRC, "index.css"))};\n@source inline(${JSON.stringify(classes.join(" "))});\n`;
  const result = await postcss([tailwind({ base: emptyBase })]).process(input, { from: path.join(SRC, "role-utilities.css") });
  css = result.css;
}, 60_000);

afterAll(() => {
  if (emptyBase) fs.rmSync(emptyBase, { recursive: true, force: true });
});

describe("F1a role utilities compile to their tokens", () => {
  it.each(UTILITIES)(".%s", (cls, declaration) => {
    expect(rule(cls), `.${cls} in the compiled CSS`).toMatch(declaration);
  });

  it.each(COLOR_ROLES)("bg-%s reads var(--%s)", (role) => {
    expect(rule(`bg-${role}`)).toMatch(new RegExp(`background-color:\\s*var\\(--${role}\\)`));
  });
});
