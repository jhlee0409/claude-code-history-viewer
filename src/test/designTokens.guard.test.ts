import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATEGORIES,
  EXEMPT_FILES,
  fingerprints,
  isTestFile,
  ratchet,
  readJsonOr,
  scanApp,
  scanSource,
  scanStylesheet,
  appTheme,
  fixtureLibParses,
  themeFromCss,
  type Baseline,
  type Category,
  type Exceptions,
  type Finding,
  type Mode,
} from "./designTokens.scanner";

/**
 * Design-token guard with an exact-baseline ratchet (inner-UI plan I0b, §4.5,
 * D13/D14).
 *
 * Fifteen bypass categories are fingerprinted per finding (file, category,
 * snippet hash, ordinal). The rule is: the fingerprints measured in src/ ==
 * the fingerprints in designTokens.baseline.json. A new one fails (more
 * bypasses, a same-count swap, a moved file, a new file); a baseline entry
 * that is no longer found fails too, so a fix cannot leave headroom behind.
 *
 *   UPDATE_TOKEN_BASELINE=prune  env -u NODE_ENV pnpm exec vitest run src/test/designTokens.guard.test.ts
 *       drop fixed fingerprints (refuses when there is a new one)
 *   UPDATE_TOKEN_BASELINE=accept env -u NODE_ENV pnpm exec vitest run src/test/designTokens.guard.test.ts
 *       take new fingerprints that each have an exception record (reason +
 *       task) in designTokens.exceptions.json - the first baseline (I0b) and
 *       file moves/renames only; also drops fixed ones
 *
 * vitest's own `--update` is not used: it would mix with snapshot updates.
 */

const ROOT = resolve(__dirname, "../..");
const BASELINE_FILE = join(ROOT, "src/test/designTokens.baseline.json");
const EXCEPTIONS_FILE = join(ROOT, "src/test/designTokens.exceptions.json");

const categoriesOf = (findings: Finding[]) => findings.map((f) => f.category);
const only = (source: string, file = "x.tsx") => categoriesOf(scanSource(source, file));

/** One sample per category: each must be found exactly once, as that category. */
const SAMPLES: Record<Category, string> = {
  palette: `<div className="bg-blue-500" />`,
  hexRgb: `<div style={{ color: "#ff6a2a" }} />`,
  arbitraryColor: `<div className="bg-[#1e1e1e]" />`,
  textOpacity: `<div className="text-muted-foreground/80" />`,
  borderOpacity: `<div className="border-border/50" />`,
  shadow: `<div className="shadow-lg" />`,
  motion: `<div className="duration-300" />`,
  zIndex: `<div className="z-[60]" />`,
  uppercaseTracking: `<span className="uppercase tracking-wider" />`,
  monoUnmarked: `<span className="font-mono" />`,
  scale: `<button className="hover:scale-105" />`,
  decoration: `<div className="backdrop-blur-sm" />`,
  radius: `<div className="rounded-xl" />`,
  spacing: `<div className="p-[7px]" />`,
  dynamicClass: "function F({ tone }: { tone: string }) { return <div className={`bg-${tone}`} />; }",
};

describe("design-token guard: detectors (one sample per category)", () => {
  it("covers the fifteen categories of the plan", () => {
    expect(CATEGORIES).toHaveLength(15);
    expect(Object.keys(SAMPLES).sort()).toEqual([...CATEGORIES].sort());
  });

  it.each(CATEGORIES.map((c) => [c, SAMPLES[c]] as const))("%s: its sample counts once", (category, source) => {
    expect(only(source)).toEqual([category]);
  });

  it("does not count tokens and allowed values", () => {
    const source = `<div className="bg-muted text-foreground border-border rounded-md rounded-lg rounded-full duration-150 duration-250 p-2 gap-3 shadow-none text-list text-muted-foreground z-10 hover:bg-accent" />`;
    expect(only(source)).toEqual([]);
  });

  it("does not count font-mono with a meaning marker or inside a mono container", () => {
    expect(only(`<span data-mono="path" className="font-mono" />`)).toEqual([]);
    expect(only(`<Code><span className="font-mono" /></Code>`)).toEqual([]);
    expect(only(`<span data-mono="decorative" className="font-mono" />`)).toEqual(["monoUnmarked"]);
  });

  it("finds bypasses through constants, conditionals and templates", () => {
    expect(only(`const C = "bg-red-500"; <div className={C} />`)).toEqual(["palette"]);
    expect(only(`declare const on: boolean; <div className={on ? "bg-red-500" : "bg-muted"} />`)).toEqual(["palette"]);
    expect(only("declare const on: boolean; const c = `p-2 ${on ? \"rounded-2xl\" : \"rounded-md\"}`;")).toEqual(["radius"]);
  });

  it("counts inline style values", () => {
    // the shadow itself, and the colour literal inside it
    expect(only(`<div style={{ boxShadow: "0 1px 2px rgba(0,0,0,.1)" }} />`).sort()).toEqual(["hexRgb", "shadow"]);
    expect(only(`<div style={{ transition: "opacity 200ms ease" }} />`)).toEqual(["motion"]);
    expect(only(`<div style={{ borderRadius: 12 }} />`)).toEqual(["radius"]);
    expect(only(`<div style={{ transition: "opacity var(--duration-fast)" }} />`)).toEqual([]);
  });

  it("counts CSS declarations, not token definitions or chart patterns", () => {
    const css = `:root { --brand: #ff6a2a; --series-1-pattern: repeating-linear-gradient(45deg, red 0 2px, transparent 2px 4px); }
.a { color: #ff6a2a; }
.b { box-shadow: 0 1px 2px rgb(0 0 0 / 10%); }
.c { transition: opacity 300ms; }
.d { border-radius: 12px; }
.e { background: linear-gradient(red, blue); }
.f { @apply bg-red-500 rounded-xl; }
.g { border-radius: var(--radius-md); transition: opacity var(--duration-fast); }`;
    const found = scanStylesheet(css, "x.css").map((f) => `${f.line} ${f.category}`);
    expect(found).toEqual(["2 hexRgb", "3 hexRgb", "3 shadow", "4 motion", "5 radius", "6 decoration", "7 palette", "7 radius"]);
  });

  it("exempts test files and standalone documents", () => {
    expect(isTestFile("src/test/x.test.ts")).toBe(true);
    expect(isTestFile("src/components/A.test.tsx")).toBe(true);
    expect(isTestFile("src/components/A.tsx")).toBe(false);
    expect(EXEMPT_FILES).toContain("src/services/export/htmlExporter.ts");
  });
});

// ---------------------------------------------------------------------------
// Review counterexamples (R3-R6): approved tokens, partial dynamics, spacing
// scale, the mono owner
// ---------------------------------------------------------------------------

/** A theme as index.css will define it (F1a/F1b): semantic shadow and radius roles. */
const SEMANTIC_THEME = themeFromCss(`:root {
  --shadow-sm: 0 1px 2px black; --shadow-lg: 0 4px 8px black;
  --shadow-popover: 0 8px 24px black; --shadow-overlay: 0 16px 48px black;
  --radius-xl: 12px; --radius-row: 6px; --radius-control: 8px; --radius-overlay: 12px; --radius-pill: 9999px; --radius-dot: 9999px;
  --ease-standard: ease;
}`);
const withTheme = (source: string, file = "x.tsx") => categoriesOf(scanSource(source, file, { theme: SEMANTIC_THEME }));

describe("design-token guard: approved semantic tokens come from index.css (R3)", () => {
  it("semantic shadow and radius utilities defined in the theme are not bypasses", () => {
    const source = `<div className="shadow-popover shadow-overlay hover:shadow-popover rounded-row rounded-control rounded-pill rounded-dot rounded-t-overlay rounded-[var(--radius-row)] rounded-(--radius-control) shadow-[var(--shadow-overlay)]" />`;
    expect(withTheme(source)).toEqual([]);
  });

  it("the same tokens in CSS and inline styles are not bypasses either", () => {
    const css = `.a { box-shadow: var(--shadow-popover); border-radius: var(--radius-row); }
.b { border-top-left-radius: var(--radius-overlay); }`;
    expect(scanStylesheet(css, "x.css", { theme: SEMANTIC_THEME })).toEqual([]);
    expect(withTheme(`<div style={{ boxShadow: "var(--shadow-overlay)", borderRadius: "var(--radius-control)" }} />`)).toEqual([]);
  });

  it("scale-step tokens (sm/lg/xl …) are not roles: they still count, in every form", () => {
    expect(withTheme(`<div className="shadow-lg" />`)).toEqual(["shadow"]);
    expect(withTheme(`<div className="rounded-xl" />`)).toEqual(["radius"]);
    expect(categoriesOf(scanStylesheet(`.a { box-shadow: var(--shadow-lg); border-radius: var(--radius-xl); }`, "x.css", { theme: SEMANTIC_THEME }))).toEqual(["shadow", "radius"]);
  });

  it("a role the theme does not define yet is still a bypass", () => {
    const bare = themeFromCss(`:root { --shadow-lg: 0 0 1px black; }`);
    expect(categoriesOf(scanSource(`<div className="shadow-popover rounded-row" />`, "x.tsx", { theme: bare }))).toEqual(["shadow", "radius"]);
  });

  it("the app theme is read from src/index.css, not a hard-coded list", () => {
    const fromFile = themeFromCss(readFileSync(join(ROOT, "src/index.css"), "utf8"));
    expect(appTheme()).toEqual(fromFile);
    expect(appTheme().eases.size).toBeGreaterThan(0);
    for (const name of [...appTheme().shadows, ...appTheme().radii]) expect(name).not.toMatch(/^(?:\d*x[sl]|sm|md|lg|base|inner|none|full|DEFAULT)$/);
  });

  it("the F1a role utilities of src/index.css are not bypasses; other steps still count", () => {
    const roles = `<div className="rounded-row rounded-control rounded-overlay rounded-pill rounded-dot shadow-popover shadow-overlay duration-fast duration-normal duration-slow ease-standard ease-emphasized" />`;
    expect(categoriesOf(scanSource(roles, "x.tsx"))).toEqual([]);
    expect(categoriesOf(scanSource(`<div className="shadow-lg rounded-xl duration-slower duration-300" />`, "x.tsx")).sort()).toEqual(["motion", "motion", "radius", "shadow"]);
    const bare = themeFromCss(`:root { --duration-fast: 150ms; }`);
    expect(categoriesOf(scanSource(`<div className="duration-fast" />`, "x.tsx", { theme: bare }))).toEqual(["motion"]);
  });
});

describe("design-token guard: partially dynamic classes (R4)", () => {
  it("a static palette prefix with an unresolved shade is a palette bypass", () => {
    expect(only("declare const shade: string; const c = `bg-red-${shade}`;")).toEqual(["palette"]);
    expect(only("declare const shade: number; const c = `hover:text-emerald-${shade}`;")).toEqual(["palette"]);
  });

  it("an unresolved part inside a style utility is a dynamic class", () => {
    expect(only("declare const r: string; const c = `shadow-[0_0_${r}px_black]`;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; const c = `border-x-${v}`;")).toEqual(["dynamicClass"]);
  });

  it("an unresolved variant does not hide a resolvable utility", () => {
    expect(only("declare const v: string; const c = `${v}:bg-red-500`;")).toEqual(["palette"]);
  });

  it("an unresolved opacity on a theme colour is a dynamic class", () => {
    expect(only("declare const o: number; const c = `text-accent/${o}`;")).toEqual(["dynamicClass"]);
  });

  it("unresolved non-style classes and keys that only look like one are not counted", () => {
    expect(only("declare const extra: string; const c = `flex ${extra} items-center`;")).toEqual([]);
    expect(only("declare const id: string; const key = `text-editor-${id}`;")).toEqual([]);
  });
});

describe("design-token guard: a style utility split mid-token in a class context (second review N2)", () => {
  // The reviewer's counterexamples: each can complete to a bypass (bg-blue-500, shadow-sm, rounded-2xl).
  it.each([
    ["declare const v: string; <div className={`bg-bl${v}-500`} />;"],
    ["declare const v: string; <div className={`shadow-s${v}`} />;"],
    ["declare const v: string; <div className={`rounded-2${v}`} />;"],
  ])("%s is a dynamic class", (source) => {
    expect(only(source)).toEqual(["dynamicClass"]);
  });

  it("a stem that is only the start of a utility root counts too (b… → bg / border, p… → p / px)", () => {
    expect(only("declare const v: string; <div className={`b${v}-red-500`} />;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; <div className={`p${v}-3`} />;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; <div className={`roun${v}`} />;")).toEqual(["dynamicClass"]);
  });

  it("spacing, motion and z-index roots with an unresolved value count", () => {
    for (const cls of ["p-${v}", "mt-${v}", "-mx-${v}", "gap-x-${v}", "space-y-${v}", "duration-${v}", "z-${v}", "md:px-${v}"]) {
      expect(only(`declare const v: string; <div className={\`${cls}\`} />;`), cls).toEqual(["dynamicClass"]);
    }
  });

  it("class contexts: className / class attributes, class helpers, *class* names", () => {
    expect(only("declare const v: string; declare function cn(...a: unknown[]): string; <div className={cn(\"flex\", `rounded-2${v}`)} />;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; declare function cn(...a: unknown[]): string; const c = cn(`shadow-s${v}`);")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; declare const on: boolean; <div className={on ? `bg-bl${v}-500` : \"bg-muted\"} />;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; const buttonClass = `shadow-s${v}`;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; const o = { className: `rounded-2${v}` };")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; const toneClass = (t: string) => `bg-bl${t}-500`;")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; function toneClassName(t: string) { return `bg-bl${t}-500`; }")).toEqual(["dynamicClass"]);
    expect(only("declare const v: string; <Icon iconClassName={`shadow-s${v}`} />;")).toEqual(["dynamicClass"]);
  });

  it("a key that only looks like a class stays uncounted; the same text as a class counts", () => {
    expect(only("declare const id: string; const key = `text-editor-${id}`;")).toEqual([]);
    expect(only("declare const id: string; declare function track(k: string): void; track(`shadow-s${id}`);")).toEqual([]);
    expect(only("declare const id: string; <div className={`text-editor-${id}`} />;")).toEqual(["dynamicClass"]);
  });

  it("non-style utilities and pass-through classes in a class context are not counted", () => {
    for (const cls of ["${v}", "${v} p-2", "flex-${v}", "top-${v}", "font-${v}", "grid-cols-${v}", "w-${v}", "items-${v}", "toast-${v}", "min-w-${v}"]) {
      expect(only(`declare const v: string; <div className={\`${cls}\`} />;`), cls).toEqual([]);
    }
  });
});

/** Shared declarations for the third-review fixtures. */
const DECL =
  "declare const v: string; declare const id: string; declare const on: boolean; declare function cn(...a: unknown[]): string; declare function clsx(...a: unknown[]): string; declare function cva(...a: unknown[]): unknown; declare function track(k: unknown): void; ";

describe("design-token guard: same-file aliases and computed class keys (third review N2)", () => {
  // The reviewer's alias counterexamples: a generically named const/let whose value reaches a className.
  it.each([["bg-bl${v}-500"], ["shadow-s${v}"], ["rounded-2${v}"]])("const c = `%s` consumed by className is a dynamic class", (cls) => {
    expect(only(`${DECL}const c = \`${cls}\`; <div className={c} />;`)).toEqual(["dynamicClass"]);
  });

  it("an alias reaches a class context through let, a helper, a template, a conditional and an alias chain", () => {
    expect(only(`${DECL}let c = \`bg-bl\${v}-500\`; <div className={c} />;`)).toEqual(["dynamicClass"]);
    expect(only(`${DECL}const c = \`shadow-s\${v}\`; <div className={cn("flex", c)} />;`)).toEqual(["dynamicClass"]);
    expect(only(`${DECL}const c = \`rounded-2\${v}\`; <div className={\`flex \${c}\`} />;`)).toEqual(["dynamicClass"]);
    expect(only(`${DECL}const c = on ? \`bg-bl\${v}-500\` : "bg-muted"; <div className={c} />;`)).toEqual(["dynamicClass"]);
    expect(only(`${DECL}const c = \`bg-bl\${v}-500\`; const d = c; <div className={d} />;`)).toEqual(["dynamicClass"]);
  });

  it("an alias used as a class twice is still one finding (it is reported at the template)", () => {
    expect(only(`${DECL}const c = \`shadow-s\${v}\`; <><div className={c} /><span className={cn(c)} /></>;`)).toEqual(["dynamicClass"]);
  });

  it("an alias that never reaches a class context stays uncounted", () => {
    expect(only(`${DECL}const key = \`text-editor-\${id}\`; track(key); const m = { [key]: true };`)).toEqual([]);
    expect(only(`${DECL}const c = \`shadow-s\${v}\`; <div data-id={c} />;`)).toEqual([]);
    // Resolved by symbol, not by name: the className uses a different `c`.
    expect(only(`${DECL}const c = \`bg-bl\${v}-500\`; track(c); function F() { const c = "flex"; return <div className={c} />; }`)).toEqual([]);
  });

  it("a computed key of an object argument of clsx / cn / classnames / cx is a class", () => {
    expect(only(`${DECL}<div className={clsx({ [\`bg-bl\${v}-500\`]: true })} />;`)).toEqual(["dynamicClass"]);
    expect(only(`${DECL}const s = cn("flex", { [\`shadow-s\${v}\`]: on });`)).toEqual(["dynamicClass"]);
    expect(only(`${DECL}const k = \`rounded-2\${v}\`; <div className={clsx({ [k]: on })} />;`)).toEqual(["dynamicClass"]);
  });

  it("a computed key elsewhere (a state map, a non-helper call, a cva variant name) is not a class", () => {
    expect(only(`${DECL}const m = { [\`text-editor-\${id}\`]: true };`)).toEqual([]);
    expect(only(`${DECL}track({ [\`shadow-s\${v}\`]: on });`)).toEqual([]);
    expect(only(`${DECL}const b = cva("flex", { variants: { [\`bg-bl\${v}-500\`]: { on: "p-2" } } });`)).toEqual([]);
  });
});

describe("design-token guard: a template with more than 64 alternatives (CodeRabbit 4308979161)", () => {
  // 7 boolean conditionals = 128 alternatives. Overflow used to fold the whole
  // template to one unknown: static tokens and conditional literals vanished.
  const OVERFLOW = Array.from({ length: 7 }, (_, i) => `\${c${i} ? "a${i}" : "b${i}"}`).join(" ");
  const DECL7 = Array.from({ length: 7 }, (_, i) => `declare const c${i}: boolean; `).join("");

  it("keeps the static head and literal spans", () => {
    expect(only(`${DECL7}declare const a: string; declare const b: string; const c = \`bg-red-500 \${a} \${b} ${OVERFLOW} shadow-lg\`;`).sort()).toEqual(["palette", "shadow"]);
  });

  it("keeps a static token between overflowing parts", () => {
    expect(only(`${DECL7}const c = \`${OVERFLOW} rounded-2xl ${OVERFLOW}\`;`)).toEqual(["radius"]);
  });

  it("still scans conditional literal branches of the folded part", () => {
    expect(only(`${DECL7}declare const on: boolean; const c = \`${OVERFLOW} \${on ? "rounded-2xl" : "rounded-md"}\`;`)).toEqual(["radius"]);
  });

  it("counts a literal inside a folded `+` span once (CodeRabbit 4309063910)", () => {
    expect(only(`${DECL7}declare const on: boolean; const c = \`${OVERFLOW} \${(on ? "a" : "b") + " rounded-2xl"}\`;`)).toEqual(["radius"]);
    expect(only(`${DECL7}declare const on: boolean; const c = \`${OVERFLOW} \${((on ? "a" : "b") + " rounded-2xl")}\`;`)).toEqual(["radius"]);
    // TypeScript wrappers around the `+` or the literal (CodeRabbit, review of c22df4fb)
    for (const span of [`((on ? "a" : "b") + " rounded-2xl") as string`, `((on ? "a" : "b") + " rounded-2xl") satisfies string`, `((on ? "a" : "b") + " rounded-2xl")!`, `(on ? "a" : "b") + (" rounded-2xl" as string)`, `(on ? "a" : "b") + (" rounded-2xl" satisfies string)`]) {
      expect(only(`${DECL7}declare const on: boolean; const c = \`${OVERFLOW} \${${span}}\`;`), span).toEqual(["radius"]);
    }
    expect(only(`${DECL7}declare const on: boolean; const c = \`${OVERFLOW} \${(on ? "a" : "b") + <string>" rounded-2xl"}\`;`, "x.ts")).toEqual(["radius"]);
  });

  it("still reports a dynamic style utility after the overflow", () => {
    expect(only(`${DECL7}declare const tone: string; <div className={\`${OVERFLOW} bg-\${tone}\`} />;`)).toEqual(["dynamicClass"]);
  });

  it("a conditional with one unresolved branch still scans the literal branch", () => {
    expect(only("declare const on: boolean; declare const cls: string; const c = `p-2 ${on ? \"rounded-2xl\" : cls}`;")).toEqual(["radius"]);
  });

  it("an in-limit template still folds its alternatives (no double count)", () => {
    expect(only("declare const on: boolean; const c = `p-2 ${on ? \"rounded-2xl\" : \"rounded-md\"}`;")).toEqual(["radius"]);
  });
});

describe("design-token guard: known limits (NOT counted; an improvement must flip these deliberately)", () => {
  // The guard is a ratchet, not a proof (scanner header, "Known limits").
  // Each source below does put an unresolved style utility into a class
  // list, but through an indirection the scanner does not follow. When the
  // scanner learns one, move its case to the counted tests above.
  it.each([
    ["a return inside a nested block of a class-named function", "function toneClassName(t: string, on: boolean) { if (on) { return `rounded-2${t}`; } return \"rounded-md\"; }"],
    ["reassignment of a generically named variable", "let c = \"flex\"; c = `bg-bl${v}-500`; <div className={c} />;"],
    ["the result of a generically named function", "const tone = (t: string) => `bg-bl${t}-500`; <div className={tone(v)} />;"],
    ["a property of a generically named object", "const o = { c: `bg-bl${v}-500` }; <div className={o.c} />;"],
    ["a destructured binding", "const [c] = [`bg-bl${v}-500`]; <div className={c} />;"],
    ["a component prop whose name is not a class name", "const Box = (p: { tone: string }) => <div className={p.tone} />; <Box tone={`bg-bl${v}-500`} />;"],
    ["an export consumed in another file", "export const c = `bg-bl${v}-500`;"],
  ])("%s", (_, source) => {
    // A fixture with a syntax error would pass vacuously.
    const parsed = ts.transpileModule(`${DECL}${source}`, { fileName: "x.tsx", reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } });
    expect(parsed.diagnostics ?? []).toEqual([]);
    expect(only(`${DECL}${source}`)).toEqual([]);
  });
});

describe("design-token guard: spacing outside the layout scale 4/8/12/16/24/32 (R5)", () => {
  it("numeric spacing utilities off the scale count", () => {
    for (const cls of ["gap-5", "px-2.5", "py-1.5", "-mt-5", "space-y-5", "p-px", "gap-x-7", "md:p-10"]) {
      expect(only(`<div className="${cls}" />`), cls).toEqual(["spacing"]);
    }
  });

  it("on-scale, zero, auto and token spacing do not count", () => {
    expect(only(`<div className="p-0 p-1 p-2 p-3 p-4 p-6 p-8 m-auto mx-auto -mt-2 gap-x-4 space-y-6 p-[var(--page-inset)] px-(--page-inset)" />`)).toEqual([]);
  });

  it("raw CSS padding / margin / gap values off the scale count", () => {
    const css = `.a { padding: 7px; }
.b { margin: 0 auto; }
.c { gap: 12px; }
.d { padding: 4px 10px; }
.e { margin-top: 0.5rem; }
.f { padding: var(--page-inset); }
.g { row-gap: 1.25rem; }`;
    expect(scanStylesheet(css, "x.css").map((f) => `${f.line} ${f.category}`)).toEqual(["1 spacing", "4 spacing", "7 spacing"]);
  });

  it("inline padding / margin / gap values off the scale count", () => {
    expect(only(`<div style={{ padding: 7 }} />`)).toEqual(["spacing"]);
    expect(only(`<div style={{ marginTop: "10px" }} />`)).toEqual(["spacing"]);
    expect(only(`<div style={{ gap: 8, paddingLeft: "var(--page-inset)", margin: 0 }} />`)).toEqual([]);
  });
});

describe("design-token guard: the mono owner itself is exempt (R6)", () => {
  it("font-mono on a mono container or a code/pre element is not counted", () => {
    for (const source of [
      `<Code className="font-mono" />`,
      `<Code className="font-mono">x</Code>`,
      `<Kbd className="font-mono">K</Kbd>`,
      `<pre className="font-mono" />`,
      `<code className="font-mono">x</code>`,
      `<pre><span className="font-mono" /></pre>`,
      `declare function cn(...a: string[]): string; <OutputBlock className={cn("font-mono", "p-2")} />`,
    ]) {
      expect(only(source), source).toEqual([]);
    }
  });

  it("font-mono on an ordinary element is still counted", () => {
    expect(only(`<div className="font-mono" />`)).toEqual(["monoUnmarked"]);
    expect(only(`<Codeish className="font-mono" />`)).toEqual(["monoUnmarked"]);
  });
});

// ---------------------------------------------------------------------------
// Ratchet: exact baseline (D14 negative tests)
// ---------------------------------------------------------------------------

describe("design-token guard: fixture scans stay cheap (second review N3)", () => {
  // Each scanSource builds a TypeScript program; re-parsing lib.es2022 +
  // lib.dom for every one made the ratchet tests exceed vitest's default 5s
  // under a full browser-enabled run. The parsed lib files are shared.
  it("parses the lib files once across fixture scans", () => {
    scanSource(`<div className="p-2" />`, "warm.tsx");
    const before = fixtureLibParses();
    for (let i = 0; i < 5; i++) scanSource(`<div className="p-${i}" />`, `n${i}.tsx`);
    expect(fixtureLibParses()).toBe(before);
  });
});

const scanFiles = (files: Record<string, string>) =>
  fingerprints(Object.entries(files).flatMap(([name, source]) => (name.endsWith(".css") ? scanStylesheet(source, name) : scanSource(source, name))));

const baselineOf = (files: Record<string, string>): Baseline => {
  const { list, snippets } = scanFiles(files);
  return { version: 1, counts: {}, fingerprints: list, snippets };
};
const noExceptions: Exceptions = { version: 1, batches: [] };

const check = (files: Record<string, string>, baseline: Baseline, mode: Mode = "check", exceptions = noExceptions) => {
  const { list, snippets } = scanFiles(files);
  return ratchet({ measured: list, snippets, baseline, exceptions, mode });
};

const START = {
  "src/A.tsx": `export const A = () => <div className="bg-red-500 rounded-xl" />;`,
  "src/B.tsx": `export const B = () => <div className="p-2" />;`,
  "src/s.css": `.a { color: #fff; }`,
};

describe("design-token guard: exact-baseline ratchet", () => {
  it("passes when measured == baseline", () => {
    expect(check(START, baselineOf(START)).ok).toBe(true);
  });

  it("fails one more bypass", () => {
    const r = check({ ...START, "src/B.tsx": `export const B = () => <div className="p-2 shadow-md" />;` }, baselineOf(START));
    expect(r.ok).toBe(false);
    expect(r.added).toHaveLength(1);
  });

  it("fails a same-count swap (one fixed, a different one added)", () => {
    const r = check({ ...START, "src/A.tsx": `export const A = () => <div className="bg-blue-500 rounded-xl" />;` }, baselineOf(START));
    expect(r.ok).toBe(false);
    expect(r.added).toHaveLength(1);
    expect(r.stale).toHaveLength(1);
  });

  it("fails a fixed bypass left in the baseline, and prune then removes it", () => {
    const fixed = { ...START, "src/A.tsx": `export const A = () => <div className="bg-muted rounded-xl" />;` };
    const r = check(fixed, baselineOf(START));
    expect(r.ok).toBe(false);
    expect(r.stale).toHaveLength(1);
    const pruned = check(fixed, baselineOf(START), "prune");
    expect(pruned.ok).toBe(true);
    expect(check(fixed, pruned.baseline!).ok).toBe(true);
  });

  it("fails re-adding a removed bypass after the prune", () => {
    const fixed = { ...START, "src/A.tsx": `export const A = () => <div className="bg-muted rounded-xl" />;` };
    const pruned = check(fixed, baselineOf(START), "prune").baseline!;
    const r = check(START, pruned);
    expect(r.ok).toBe(false);
    expect(r.added).toHaveLength(1);
  });

  it("fails a renamed or moved file (new path = new fingerprints)", () => {
    const { "src/A.tsx": a, ...rest } = START;
    const r = check({ ...rest, "src/moved/A.tsx": a }, baselineOf(START));
    expect(r.ok).toBe(false);
    expect(r.added).toHaveLength(2);
    expect(r.stale).toHaveLength(2);
  });

  it("fails a new file with a bypass", () => {
    expect(check({ ...START, "src/C.tsx": `export const C = () => <i className="text-amber-500" />;` }, baselineOf(START)).ok).toBe(false);
  });

  it("fails a new dynamic class, inline style and CSS declaration", () => {
    for (const [file, source] of [
      ["src/D.tsx", "export const D = ({ t }: { t: string }) => <div className={`text-${t}`} />;"],
      ["src/E.tsx", `export const E = () => <div style={{ boxShadow: "0 0 4px black" }} />;`],
      ["src/s.css", `.a { color: #fff; }\n.b { z-index: 999; }`],
    ] as const) {
      expect(check({ ...START, [file]: source }, baselineOf(START)).ok, file).toBe(false);
    }
  });

  it("prune refuses new fingerprints", () => {
    const r = check({ ...START, "src/C.tsx": `export const C = () => <i className="text-amber-500" />;` }, baselineOf(START), "prune");
    expect(r.ok).toBe(false);
    expect(r.baseline).toBeUndefined();
  });

  it("accept refuses a new fingerprint without a reason, takes it with one", () => {
    const next = { ...START, "src/C.tsx": `export const C = () => <i className="text-amber-500" />;` };
    expect(check(next, baselineOf(START), "accept").ok).toBe(false);
    const { list } = scanFiles(next);
    const added = list.filter((fp) => !baselineOf(START).fingerprints.includes(fp));
    const exceptions: Exceptions = { version: 1, batches: [{ task: "XX", reason: "approved in review", fingerprints: added }] };
    const accepted = check(next, baselineOf(START), "accept", exceptions);
    expect(accepted.ok).toBe(true);
    expect(check(next, accepted.baseline!).ok).toBe(true);
  });

  it("numbers repeated snippets in a file (one more copy is new)", () => {
    const one = { "src/A.tsx": `<div className="bg-red-500" />` };
    const two = { "src/A.tsx": `<><div className="bg-red-500" /><div className="bg-red-500" /></>` };
    const r = check(two, baselineOf(one));
    expect(r.ok).toBe(false);
    expect(r.added[0]).toMatch(/\|2$/);
  });
});

// ---------------------------------------------------------------------------
// src/: the enforced baseline
// ---------------------------------------------------------------------------

describe("readJsonOr: only a missing file falls back", () => {
  // A merge left conflict markers in the exceptions file; swallowing the parse
  // error turned it into "no batches" and a prune run rewrote it empty.
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tokens-json-"));
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it("returns the fallback when the file does not exist", () => {
    expect(readJsonOr(join(dir, "missing.json"), { batches: [] })).toEqual({ batches: [] });
  });

  it("parses an existing file", () => {
    const file = join(dir, "ok.json");
    writeFileSync(file, JSON.stringify({ batches: [{ task: "T" }] }));
    expect(readJsonOr(file, { batches: [] })).toEqual({ batches: [{ task: "T" }] });
  });

  it("rethrows a parse error, naming the file (conflict markers)", () => {
    const file = join(dir, "conflict.json");
    writeFileSync(file, '{\n<<<<<<< HEAD\n  "batches": []\n=======\n  "batches": [1]\n>>>>>>> other\n}\n');
    expect(() => readJsonOr(file, { batches: [] })).toThrow(file);
  });
});

describe("design-token guard: src/ matches designTokens.baseline.json exactly", () => {
  let scan: ReturnType<typeof scanApp>;
  beforeAll(() => {
    scan = scanApp();
  }, 120_000);

  it("scans the app sources, without tests and standalone documents", () => {
    expect(scan.files).toBeGreaterThan(300);
    expect(scan.findings.filter((f) => isTestFile(f.file) || EXEMPT_FILES.includes(f.file))).toEqual([]);
  });

  it("every baseline fingerprint has an exception record (reason + task)", () => {
    const baseline = readJsonOr<Baseline>(BASELINE_FILE, { version: 1, counts: {}, fingerprints: [], snippets: {} });
    const exceptions = readJsonOr<Exceptions>(EXCEPTIONS_FILE, { version: 1, batches: [] });
    for (const batch of exceptions.batches) {
      expect(batch.reason.trim(), `batch ${batch.task}`).not.toBe("");
      expect(batch.task.trim()).not.toBe("");
    }
    const explained = new Set(exceptions.batches.flatMap((b) => b.fingerprints));
    expect(baseline.fingerprints.filter((fp) => !explained.has(fp))).toEqual([]);
  });

  it("measured fingerprints == baseline fingerprints", () => {
    const mode = (process.env.UPDATE_TOKEN_BASELINE ?? "check") as Mode;
    if (!["check", "prune", "accept"].includes(mode)) throw new Error(`UPDATE_TOKEN_BASELINE must be prune or accept (got ${mode})`);
    const { list, snippets } = fingerprints(scan.findings);
    const baseline = readJsonOr<Baseline>(BASELINE_FILE, { version: 1, counts: {}, fingerprints: [], snippets: {} });
    const exceptions = readJsonOr<Exceptions>(EXCEPTIONS_FILE, { version: 1, batches: [] });
    const result = ratchet({ measured: list, snippets, baseline, exceptions, mode });
    if (result.ok && result.baseline) {
      writeFileSync(BASELINE_FILE, JSON.stringify(result.baseline, null, 2) + "\n");
      writeFileSync(EXCEPTIONS_FILE, JSON.stringify(result.exceptions, null, 2) + "\n");
    }
    expect(result.messages.join("\n\n")).toBe("");
    expect(result.ok).toBe(true);
  }, 60_000);
});
