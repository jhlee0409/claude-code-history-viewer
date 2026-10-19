import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_NAMES, TokenError, createTokenResolver } from "./utils/oklchContrast";
import { COLOR_ROLES, VALUE_ROLES } from "./utils/roleTokens";

/**
 * Every F1a role token (inner-UI plan §4.1) has a value in all four themes
 * (light, dark, high contrast, dark high contrast) and a Tailwind utility,
 * and the resolver the contrast tests rely on reports what would make a
 * token silently wrong: a cycle, a reference to nothing, a translucent
 * colour, a light high-contrast value leaking into the dark one.
 */

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = createTokenResolver();

/** `@theme` declarations (all blocks), name -> value. */
const THEME_DECLS = new Map(
  [...CSS.matchAll(/^@theme\b[^{]*\{([\s\S]*?)\n\}/gm)].flatMap((m) =>
    [...(m[1] ?? "").matchAll(/(--[\w*-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1] ?? "", (d[2] ?? "").trim()] as const),
  ),
);

describe("role tokens: parity across themes (F1a)", () => {
  describe.each(THEME_NAMES)("%s theme", (theme) => {
    it.each(COLOR_ROLES)("--%s is an opaque colour", (role) => {
      expect(() => tokens.color(theme, role)).not.toThrow();
    });

    it.each(VALUE_ROLES.map(([role]) => role))("--%s has a value", (role) => {
      expect(tokens.value(theme, role)).not.toBe("");
    });
  });

  it.each(COLOR_ROLES)("--%s has a Tailwind colour (--color-%s)", (role) => {
    expect(THEME_DECLS.get(`--color-${role}`)).toBe(`var(--${role})`);
  });

  it.each(VALUE_ROLES.filter(([role, key]) => key !== null && key !== role))(
    "--%s is wired to the Tailwind key --%s",
    (role, key) => {
      expect(THEME_DECLS.get(`--${key}`)).toBe(`var(--${role})`);
    },
  );

  it("roles that are Tailwind theme keys themselves (curves, radius roles) are declared in @theme", () => {
    for (const [role] of VALUE_ROLES.filter(([r, key]) => key === r)) expect(THEME_DECLS.has(`--${role}`), `--${role}`).toBe(true);
    for (const role of ["ease-standard", "ease-emphasized"]) expect(THEME_DECLS.get(`--${role}`)).toMatch(/^cubic-bezier\(/);
  });

  it("a transition without its own duration or curve uses the fast duration and the standard curve", () => {
    expect(THEME_DECLS.get("--default-transition-duration")).toBe("var(--duration-fast)");
    expect(THEME_DECLS.get("--default-transition-timing-function")).toBe("var(--ease-standard)");
  });

  it("no @theme entry refers to itself (the old --radius-sm: var(--radius-sm))", () => {
    const selfRefs = [...THEME_DECLS].filter(([name, value]) => value === `var(${name})`).map(([name]) => name);
    expect(selfRefs).toEqual([]);
  });

  it("only the three motion durations and two curves remain (plan G-MO2)", () => {
    const durations = [...CSS.matchAll(/^\s*--duration-([\w-]+)\s*:\s*([^;]+);/gm)].map((m) => `${m[1]}=${m[2]}`);
    expect(durations.sort()).toEqual(["fast=150ms", "normal=250ms", "slow=400ms"]);
    const eases = [...CSS.matchAll(/^\s*--ease-([\w-]+)\s*:/gm)].map((m) => m[1]);
    expect(eases.sort()).toEqual(["emphasized", "standard"]);
  });
});

describe("token resolver (fixtures)", () => {
  const fixture = (css: string) => createTokenResolver(css);

  it("follows aliases through the theme's cascade", () => {
    const r = fixture(`:root {\n  --a: oklch(0.5 0 0);\n  --b: var(--a);\n}\n.dark {\n  --a: oklch(0.9 0 0);\n}\n`);
    expect(r.color("light", "b")).toEqual([0.5, 0, 0]);
    expect(r.color("dark", "b")).toEqual([0.9, 0, 0]);
    expect(r.winner("dark", "b")).toBe(":root");
  });

  it("reads @theme blocks last", () => {
    const r = fixture(`:root {\n  --x: 1px;\n}\n@theme inline {\n  --y: var(--x);\n  --x: 2px;\n}\n`);
    expect(r.value("light", "y")).toBe("1px");
  });

  it("reports a cycle", () => {
    const r = fixture(`:root {\n  --a: var(--b);\n  --b: var(--a);\n}\n`);
    expect(() => r.value("light", "a")).toThrow(TokenError);
    expect(() => r.value("light", "a")).toThrow(/cycle/);
  });

  it("reports a reference to nothing, and uses a var() fallback when there is one", () => {
    const r = fixture(`:root {\n  --a: var(--missing);\n  --b: var(--missing, oklch(0.4 0 0));\n}\n`);
    expect(() => r.value("light", "a")).toThrow(/--missing is not defined/);
    expect(r.color("light", "b")).toEqual([0.4, 0, 0]);
  });

  it("rejects a translucent or non-oklch colour", () => {
    const r = fixture(`:root {\n  --a: oklch(0.5 0 0 / 0.6);\n  --b: color-mix(in oklch, var(--c) 50%, transparent);\n  --c: oklch(0.5 0 0);\n}\n`);
    expect(() => r.color("light", "a")).toThrow(/not an opaque/);
    expect(() => r.color("light", "b")).toThrow(/not an opaque/);
  });

  it("reports a light high-contrast value leaking into the dark high-contrast theme", () => {
    const leak = `:root {\n  --a: oklch(0.5 0 0);\n}\n.dark {\n  --a: oklch(0.8 0 0);\n}\n.high-contrast {\n  --a: oklch(0.2 0 0);\n}\n.dark.high-contrast {\n  --b: oklch(0.9 0 0);\n}\n`;
    expect(() => fixture(leak).color("dark high contrast", "a")).toThrow(/leak|overrides \.dark/);
    const fixed = leak.replace("--b: oklch(0.9 0 0);", "--a: oklch(0.9 0 0);");
    expect(fixture(fixed).color("dark high contrast", "a")).toEqual([0.9, 0, 0]);
  });
});
