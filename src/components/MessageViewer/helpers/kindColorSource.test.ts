import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MINIMAP_FAILED_CSS_VAR,
  MINIMAP_KIND_CSS_VAR,
  kindColorSource,
  minimapFailedColor,
} from "./kindColorSource";
import { MINIMAP_KIND_PRIORITY } from "./minimapLayout";
import type { MessageKind } from "./messageKinds";

/**
 * `getComputedStyle` resolution of custom properties set via inline style is
 * version-dependent in jsdom/cssstyle, so this stubs `window.getComputedStyle`
 * directly with a mutable variable map. That proves the "reads at call time,
 * never cached" contract (Decision 4) rather than relying on jsdom's own CSS
 * cascade.
 */
function stubComputedStyle(vars: Record<string, string>) {
  return vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) => vars[name] ?? "",
      }) as CSSStyleDeclaration,
  );
}

describe("kindColorSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps every MessageKind to its CSS custom property", () => {
    const kinds = Object.keys(MINIMAP_KIND_PRIORITY) as MessageKind[];
    for (const kind of kinds) {
      expect(MINIMAP_KIND_CSS_VAR[kind]).toBeDefined();
    }
    // Shared-color kinds per Design §5's verified constraints.
    expect(MINIMAP_KIND_CSS_VAR.prompt).toBe("--info");
    expect(MINIMAP_KIND_CSS_VAR.command).toBe("--info");
    expect(MINIMAP_KIND_CSS_VAR.context).toBe("--muted-foreground");
    expect(MINIMAP_KIND_CSS_VAR.tool).toBe("--muted-foreground");
    expect(MINIMAP_KIND_CSS_VAR.system).toBe("--muted-foreground");
    expect(MINIMAP_KIND_CSS_VAR["agent-update"]).toBe("--tool-task");
    expect(MINIMAP_KIND_CSS_VAR.reply).toBe("--warning");
    expect(MINIMAP_KIND_CSS_VAR.summary).toBe("--tool-mcp");
  });

  it("reads the CSS custom property at call time, not once at mount", () => {
    const vars: Record<string, string> = { "--info": "oklch(0.45 0.12 240)" };
    const spy = stubComputedStyle(vars);

    expect(kindColorSource.colorForKind("prompt")).toBe("oklch(0.45 0.12 240)");
    expect(spy).toHaveBeenCalledTimes(1);

    // Change the value between calls (a theme switch) with no re-mount.
    vars["--info"] = "oklch(0.75 0.16 240)";
    expect(kindColorSource.colorForKind("prompt")).toBe("oklch(0.75 0.16 240)");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("trims the resolved value", () => {
    stubComputedStyle({ "--info": "  oklch(0.45 0.12 240)  " });
    expect(kindColorSource.colorForKind("prompt")).toBe("oklch(0.45 0.12 240)");
  });

  it("returns null when the custom property resolves empty", () => {
    stubComputedStyle({});
    expect(kindColorSource.colorForKind("reply")).toBeNull();
  });

  it("delegates priority to the Design §4 table", () => {
    expect(kindColorSource.priorityForKind("prompt")).toBe(MINIMAP_KIND_PRIORITY.prompt);
    expect(kindColorSource.priorityForKind("system")).toBe(MINIMAP_KIND_PRIORITY.system);
  });

  it("minimapFailedColor reads the destructive token at call time", () => {
    const vars: Record<string, string> = { [MINIMAP_FAILED_CSS_VAR]: "oklch(0.48 0.20 25)" };
    stubComputedStyle(vars);
    expect(minimapFailedColor()).toBe("oklch(0.48 0.20 25)");

    vars[MINIMAP_FAILED_CSS_VAR] = "oklch(0.78 0.18 25)";
    expect(minimapFailedColor()).toBe("oklch(0.78 0.18 25)");
  });
});
