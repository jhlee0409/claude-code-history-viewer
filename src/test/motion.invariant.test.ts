import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "@/utils/motion";

/**
 * Reduced motion for JS scrolls (inner-UI plan F1b, G-MO1: "9 smooth scrolls
 * ignore the setting"). The base layer stops CSS motion; a scroll called
 * with `behavior: "smooth"` would still glide, so every caller asks
 * `scrollBehavior()`.
 */

const SRC = resolve(__dirname, "..");

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrollBehavior()", () => {
  it("is smooth without a preference", () => {
    mockReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is an instant jump under prefers-reduced-motion: reduce, read at call time", () => {
    mockReducedMotion(true);
    expect(scrollBehavior()).toBe("auto");
    mockReducedMotion(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("falls back to smooth when matchMedia is missing or throws", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(scrollBehavior()).toBe("smooth");
    vi.stubGlobal("matchMedia", () => {
      throw new Error("blocked");
    });
    expect(scrollBehavior()).toBe("smooth");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" || name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const SMOOTH_LITERAL = /behavior\s*:\s*["'`]smooth["'`]/;

describe("no hard-coded smooth scroll (invariant)", () => {
  it("detects the pattern it guards against", () => {
    expect(SMOOTH_LITERAL.test(`el.scrollIntoView({ behavior: "smooth", block: "center" })`)).toBe(true);
    expect(SMOOTH_LITERAL.test(`v.scrollToIndex(i, { align: 'center', behavior: 'smooth' })`)).toBe(true);
    expect(SMOOTH_LITERAL.test(`el.scrollIntoView({ behavior: scrollBehavior(), block: "center" })`)).toBe(false);
  });

  it("every scroll in src asks scrollBehavior()", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join("utils", "motion.ts")))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .map((line, i) => [line, i + 1] as const)
          .filter(([line]) => SMOOTH_LITERAL.test(line))
          .map(([, n]) => `${relative(SRC, file)}:${n}`),
      );
    expect(offenders).toEqual([]);
  });
});
