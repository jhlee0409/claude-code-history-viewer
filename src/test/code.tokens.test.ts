import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { themes } from "prism-react-renderer";
import { PROVIDER_IDS, getProviderBadgeStyle } from "@/utils/providers";
import { SUBAGENT_STYLES, getSubagentStyle } from "@/utils/agentStyles";
import { getPreStyles, getTokenStyles } from "@/utils/prismStyles";
import { THEME_NAMES, createTokenResolver, contrast } from "./utils/oklchContrast";
import { scanSource } from "./designTokens.scanner";

const tokens = createTokenResolver();

describe("F1c role-only identity and syntax consumers", () => {
  it.each(["providers", "agentStyles", "prismStyles"])("%s has no palette or literal colour escape", (file) => {
    const source = readFileSync(resolve(__dirname, `../utils/${file}.ts`), "utf8");
    expect(scanSource(source, `src/utils/${file}.ts`).filter((f) => ["palette", "hexRgb", "arbitraryColor"].includes(f.category))).toEqual([]);
  });

  it("each provider uses its own explicit role, retaining the canonical fallback", () => {
    for (const id of PROVIDER_IDS) {
      expect(getProviderBadgeStyle(id)).toBe(`bg-provider-${id}-surface text-provider-${id}`);
      for (const theme of THEME_NAMES) {
        expect(contrast(tokens.color(theme, `provider-${id}`), tokens.color(theme, `provider-${id}-surface`))).toBeGreaterThanOrEqual(4.5);
        for (const suffix of ["", "-surface"]) expect(tokens.value(theme, `color-provider-${id}${suffix}`)).toBe(tokens.value(theme, `provider-${id}${suffix}`));
      }
    }
    expect(getProviderBadgeStyle("unknown")).toBe(getProviderBadgeStyle("claude"));
  });

  it("agent role migration retains all five distinct icons and matching/fallback", () => {
    expect(new Set(Object.values(SUBAGENT_STYLES).map((s) => s.icon)).size).toBe(5);
    Object.values(SUBAGENT_STYLES).forEach((style, i) => {
      expect(style).toMatchObject({ bg: `bg-agent-${i + 1}-surface`, text: `text-agent-${i + 1}`, border: `border-agent-${i + 1}-line` });
      for (const theme of THEME_NAMES) {
        expect(contrast(tokens.color(theme, `agent-${i + 1}`), tokens.color(theme, `agent-${i + 1}-surface`))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.color(theme, `agent-${i + 1}-line`), tokens.color(theme, "card"))).toBeGreaterThanOrEqual(3);
        for (const suffix of ["", "-surface", "-line"]) expect(tokens.value(theme, `color-agent-${i + 1}${suffix}`)).toBe(tokens.value(theme, `agent-${i + 1}${suffix}`));
      }
    });
    expect(getSubagentStyle("custom-EXPLORE-agent")).toBe(SUBAGENT_STYLES.Explore);
    expect(getSubagentStyle()).toBe(SUBAGENT_STYLES["general-purpose"]);
  });

  it.each([false, true])("Prism output resolves to roles, ignoring theme literals (dark=%s)", (dark) => {
    const theme = dark ? themes.vsDark : themes.vsLight;
    expect(getPreStyles(dark, theme.plain)).toMatchObject({ color: "var(--fg)", backgroundColor: "var(--surface-well)" });
    for (const entry of theme.styles) {
      const output = getTokenStyles(dark, entry.style);
      expect(output.color).toMatch(/^var\(--(?:code-(?:keyword|string|number|comment|function|type|punct)|fg)\)$/);
      expect(output).toMatchObject({ backgroundColor: "transparent", border: "none", borderRadius: 0, padding: 0 });
    }
    for (const [type, role] of [["comment", "comment"], ["builtin", "keyword"], ["number", "number"], ["string", "string"], ["function", "function"], ["class-name", "type"]]) {
      const style = theme.styles.find((entry) => entry.types.includes(type!))!.style;
      expect(getTokenStyles(dark, style).color).toBe(`var(--code-${role})`);
    }
    expect(getTokenStyles(dark, { color: "unrecognized", fontStyle: "italic" })).toMatchObject({ color: "var(--fg)", fontStyle: "italic" });
    expect(getPreStyles(dark, {}, { margin: 4 })).toMatchObject({ margin: 4 });
  });
});
