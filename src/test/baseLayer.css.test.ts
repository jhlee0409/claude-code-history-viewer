import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * The F1b base layer of src/index.css (inner-UI plan §4.1, F1b): one focus
 * ring, reduced motion, forced colours, CJK line breaking and line height,
 * prose spacing in rem, no legacy label classes. These pin the rules
 * themselves; the real-WebKit / Chromium tests in scripts/ui-capture/test
 * (motion.reduce, forcedColors, contrast.more, cjk.wordBreak) check what the
 * browser computes in the running app.
 */

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const root = postcss.parse(CSS);

const baseLayers = root.nodes.filter((n): n is AtRule => n.type === "atrule" && n.name === "layer" && n.params === "base");
const inBase = (pick: (rule: Rule) => boolean) => {
  const out: Rule[] = [];
  for (const layer of baseLayers) layer.walkRules((rule) => void (pick(rule) && out.push(rule)));
  return out;
};
const media = (rule: Rule) => (rule.parent?.type === "atrule" && (rule.parent as AtRule).name === "media" ? (rule.parent as AtRule).params : null);
const decls = (rule: Rule) => Object.fromEntries(rule.nodes.filter((n) => n.type === "decl").map((d) => [d.prop, `${d.value}${d.important ? " !important" : ""}`]));
const selectors = (rule: Rule) => rule.selectors.map((s) => s.replace(/\s+/g, " ").trim());

describe("F1b base layer", () => {
  it("draws one keyboard focus ring from the F1a tokens (no outline-none)", () => {
    const rules = inBase((r) => selectors(r).includes(":focus-visible") && media(r) === null);
    expect(rules).toHaveLength(1);
    expect(decls(rules[0]!)).toEqual({
      outline: "var(--focus-ring-width) solid var(--focus-ring)",
      "outline-offset": "var(--focus-ring-offset)",
    });
    expect(CSS).not.toMatch(/:focus-visible\s*\{\s*@apply outline-none/);
  });

  it("switches off every animation, transition and smooth scroll under prefers-reduced-motion: reduce", () => {
    const rules = inBase((r) => media(r) === "(prefers-reduced-motion: reduce)");
    expect(rules).toHaveLength(1);
    expect(selectors(rules[0]!)).toEqual(["*", "*::before", "*::after"]);
    expect(decls(rules[0]!)).toEqual({
      animation: "none !important",
      transition: "none !important",
      "scroll-behavior": "auto !important",
    });
  });

  it("forced colours: focus is a CanvasText outline, selection a Highlight border and underline", () => {
    const rules = inBase((r) => media(r) === "(forced-colors: active)");
    const focus = rules.find((r) => selectors(r).includes(":focus-visible"));
    expect(decls(focus!)).toMatchObject({ outline: "2px solid CanvasText !important", "outline-offset": "2px !important" });
    const selected = rules.find((r) => selectors(r).includes('[aria-selected="true"]'));
    expect(selectors(selected!)).toEqual([
      '[aria-selected="true"]',
      '[aria-pressed="true"]',
      '[aria-checked="true"]',
      '[aria-current]:not([aria-current="false"])',
      '[data-state="on"]',
      '[data-state="active"]',
      '[data-state="checked"]',
    ]);
    expect(decls(selected!)).toMatchObject({
      "border-color": "Highlight !important",
      "text-decoration-line": "underline !important",
      "text-decoration-color": "Highlight !important",
      "text-decoration-thickness": "2px !important",
    });
  });

  it("forced colours: the inset ring stays inset (its control would clip a ring drawn outside)", () => {
    const rules = inBase((r) => media(r) === "(forced-colors: active)");
    const inset = rules.find((r) => selectors(r).includes(".focus-ring-inset:focus-visible"));
    // Same layer and !important as the forced `:focus-visible` offset, higher
    // specificity, so it wins over the 2px outside offset.
    expect(decls(inset!)).toEqual({ "outline-offset": "var(--focus-ring-inset) !important" });
  });

  it("Korean breaks between words; Japanese and Chinese keep per-character breaking (never keep-all)", () => {
    const ko = inBase((r) => selectors(r).includes(":lang(ko)"));
    expect(ko.map(decls)).toEqual([{ "word-break": "keep-all", "overflow-wrap": "break-word" }]);
    const jaZh = inBase((r) => selectors(r).includes(":lang(ja)"));
    expect(jaZh.map(selectors)).toEqual([[":lang(ja)", ":lang(zh)"]]);
    expect(jaZh.map(decls)).toEqual([{ "line-break": "strict" }]);
    root.walkRules((rule) => {
      if (rule.selectors.some((s) => /:lang\((ja|zh)/.test(s))) expect(decls(rule)["word-break"], rule.selector).toBeUndefined();
    });
  });

  it("a formatted number (<Num>, [data-num]) breaks like a number: word-break normal, after the Korean rule", () => {
    const num = inBase((r) => selectors(r).includes("[data-num]"));
    expect(num.map(selectors)).toEqual([["[data-num]"]]);
    expect(num.map(decls)).toEqual([{ "word-break": "normal" }]);
    // [data-num] and :lang(ko) have the same specificity, so the later rule wins.
    const wordBreak = inBase((r) => decls(r)["word-break"] !== undefined).map((r) => r.selector);
    // The only word-break rules in the base layer: no class-based exemption (.font-mono, .tabular-nums).
    expect(wordBreak).toEqual([":lang(ko)", "[data-num]"]);
  });

  it("never lowers min-content: no anywhere / break-all wrapping and no per-class exemption in the base layer", () => {
    // `overflow-wrap: anywhere` and `word-break: break-all` count their break
    // points in min-content, so a squeezed flex or grid item splits 69 into
    // 6/9 and 1.4 MB into 1/./4/M/B. `break-word` only breaks a word wider
    // than its whole line, so no element needs an exemption (none may exist,
    // or numbers would depend on carrying a class again).
    const lowering: string[] = [];
    for (const layer of baseLayers) {
      layer.walkDecls((d) => {
        if ((d.prop === "overflow-wrap" || d.prop === "word-wrap") && d.value === "anywhere") lowering.push(`${(d.parent as Rule).selector} { ${d} }`);
        if (d.prop === "word-break" && /break-all|break-word/.test(d.value)) lowering.push(`${(d.parent as Rule).selector} { ${d} }`);
      });
    }
    expect(lowering).toEqual([]);
    const wrapping = inBase((r) => /:lang\(/.test(r.selector) && decls(r)["overflow-wrap"] !== undefined);
    expect(wrapping.map(selectors)).toEqual([[":lang(ko)"]]);
  });

  it("caption and list text get line height 1.5 in Korean, Japanese and Chinese (1.4 otherwise)", () => {
    const leading: Record<string, Record<string, string>> = {};
    root.walkRules((rule) => {
      if (!/^:root(:lang\(|$)/.test(rule.selector) || rule.parent?.type !== "root") return;
      const d = decls(rule);
      if (d["--leading-caption"]) leading[rule.selector] = { caption: d["--leading-caption"]!, list: d["--leading-list"]! };
    });
    expect(leading[":root"]).toEqual({ caption: "1.4", list: "1.4" });
    const cjk = Object.entries(leading).filter(([selector]) => selector !== ":root");
    expect(cjk.map(([s]) => s).join(" ")).toMatch(/lang\(ko\).*lang\(ja\).*lang\(zh-CN\).*lang\(zh-TW\)/);
    for (const [, value] of cjk) expect(value).toEqual({ caption: "1.5", list: "1.5" });
    expect(CSS).toMatch(/--text-caption--line-height:\s*var\(--leading-caption\);/);
    expect(CSS).toMatch(/--text-list--line-height:\s*var\(--leading-list\);/);
  });

  it(".prose spacing is rem × the app font scale, never em of each element's own size", () => {
    const prose = inBase((r) => r.selector.includes(".prose"));
    expect(prose.length).toBeGreaterThan(10);
    const em = prose.flatMap((r) => r.nodes.filter((n) => n.type === "decl" && /\d(\.\d+)?em\b/.test(n.value)).map((d) => `${r.selector} { ${d.toString()} }`));
    expect(em).toEqual([]);
  });

  it("the legacy uppercase label classes are gone (.data-label, .metric-label, .metric-value)", () => {
    expect(CSS).not.toMatch(/\.(data-label|metric-label|metric-value)\b/);
  });
});
