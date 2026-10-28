import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("series-check reproducible measurement command", () => {
  it("emits the full theme/contrast/CVD matrix and enforces its actual thresholds", () => {
    expect(existsSync("scripts/tokens/series-check.mjs"), "measurement command is missing").toBe(true);
    const raw = execFileSync(process.execPath, ["scripts/tokens/series-check.mjs"], { encoding: "utf8" });
    const report = JSON.parse(raw);
    expect(report.thresholds).toEqual({ contrast: 3, deltaE00: 10 });
    expect(report.contrast).toHaveLength(28);
    expect(report.pairs).toHaveLength(96);
    expect(new Set(report.pairs.map((row: { mode: string }) => row.mode))).toEqual(new Set(["normal", "protanopia", "deuteranopia", "tritanopia"]));
    expect(report.contrast.every((row: { ratio: number }) => row.ratio >= 3)).toBe(true);
    expect(report.pairs.every((row: { deltaE00: number }) => row.deltaE00 >= 10)).toBe(true);
    expect(report.pass).toBe(true);
  });

  it.each([
    ["duplicate categories", { light: Array(4).fill([0.5, 0, 0]), dark: Array(4).fill([0.7, 0, 0]) }, "distance"],
    ["invisible marks", { light: Array(4).fill([1, 0, 0]), dark: Array(4).fill([0, 0, 0]) }, "contrast"],
    ["malformed triples", { light: [[0.5, 0, "not a hue"]], dark: [] }, "invalid"],
  ] as const)("rejects %s rather than rounding or skipping failures", (_name, candidate, failure) => {
    mkdirSync("scratch", { recursive: true });
    const dir = mkdtempSync(resolve("scratch/series-candidate-"));
    try {
      const file = resolve(dir, "candidate.json");
      writeFileSync(file, JSON.stringify(candidate));
      const result = spawnSync(process.execPath, ["scripts/tokens/series-check.mjs", "--candidate", file], { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      if (failure === "invalid") {
        expect(result.stderr).toContain("Invalid light candidate");
      } else {
        const report = JSON.parse(result.stdout);
        expect(report.pass).toBe(false);
        if (failure === "distance") expect(report.pairs.every((row: { deltaE00: number }) => row.deltaE00 === 0)).toBe(true);
        else expect(report.contrast.some((row: { ratio: number }) => row.ratio < 3)).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
