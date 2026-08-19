import { describe, expect, it } from "vitest";

import {
  ENTRYPOINT_BADGE_META,
  matchesEntrypointFilter,
  normalizeEntrypoint,
} from "@/utils/entrypoint";

describe("normalizeEntrypoint", () => {
  it("maps Claude Code client values", () => {
    expect(normalizeEntrypoint("cli")).toBe("cli");
    expect(normalizeEntrypoint("claude-vscode")).toBe("vscode");
    expect(normalizeEntrypoint("claude-desktop")).toBe("desktop");
  });

  it("maps copilot entrypoint values", () => {
    expect(normalizeEntrypoint("copilot-cli")).toBe("cli");
    expect(normalizeEntrypoint("copilot-vscode")).toBe("vscode");
    expect(normalizeEntrypoint("copilot-desktop")).toBe("desktop");
  });

  it("maps kimi entrypoint values derived from kimi-code state", () => {
    expect(normalizeEntrypoint("kimi-cli")).toBe("cli");
    expect(normalizeEntrypoint("kimi-vscode")).toBe("vscode");
  });

  it("degrades unknown and missing values to null", () => {
    expect(normalizeEntrypoint("some-future-client")).toBeNull();
    expect(normalizeEntrypoint("")).toBeNull();
    expect(normalizeEntrypoint(null)).toBeNull();
    expect(normalizeEntrypoint(undefined)).toBeNull();
  });

  it("provides badge metadata for every category", () => {
    for (const category of ["cli", "vscode", "desktop"] as const) {
      const meta = ENTRYPOINT_BADGE_META[category];
      expect(meta.i18nKey).toBeTruthy();
      expect(meta.badgeClass).toBeTruthy();
    }
  });
});

describe("matchesEntrypointFilter", () => {
  it("passes everything under the all filter", () => {
    expect(matchesEntrypointFilter("kimi-vscode", "all")).toBe(true);
    expect(matchesEntrypointFilter(null, "all")).toBe(true);
  });

  it("matches kimi values against their normalized category", () => {
    expect(matchesEntrypointFilter("kimi-vscode", "vscode")).toBe(true);
    expect(matchesEntrypointFilter("kimi-vscode", "cli")).toBe(false);
    expect(matchesEntrypointFilter("kimi-cli", "cli")).toBe(true);
  });

  it("excludes sessions without an entrypoint from category filters", () => {
    expect(matchesEntrypointFilter(null, "cli")).toBe(false);
  });
});
