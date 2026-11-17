import { describe, expect, it } from "vitest";
import * as color from "./utils/oklchContrast";

const MODES = ["protanopia", "deuteranopia", "tritanopia"] as const;

describe("Machado 2009 full-severity CVD pipeline", () => {
  it("exports a linear-light simulation, not a gamma-encoded matrix", () => {
    expect(color).toHaveProperty("simulateCvd");
    const red: [number, number, number] = [1, 0, 0];
    expect(color.simulateCvd(red, "protanopia")).toEqual([0.152286, 0.114503, 0]);
    expect(color.simulateCvd(red, "deuteranopia")).toEqual([0.367322, 0.280085, 0]);
    expect(color.simulateCvd(red, "tritanopia")).toEqual([1, 0, 0.004733]);
  });

  it("validates CIEDE2000 against independent Sharma reference pairs", () => {
    expect(color).toHaveProperty("deltaE00Lab");
    for (const [a, b, expected] of [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 0, 0], [50, -1, 2], 2.3669],
    ] as const) {
      expect(color.deltaE00Lab([...a], [...b])).toBeCloseTo(expected, 4);
      expect(color.deltaE00Lab([...b], [...a])).toBeCloseTo(expected, 4);
    }
  });

  it("simulates before CIELAB distance and catches a red/green collision", () => {
    expect(color).toHaveProperty("simulateCvd");
    const red: color.Oklch = [0.6, 0.2, 25];
    const green: color.Oklch = [0.6, 0.2, 145];
    expect(color.deltaE00(red, green)).toBeGreaterThan(40);
    expect(color.deltaE00(red, green, "deuteranopia")).toBeLessThan(10);
    for (const mode of MODES) {
      expect(color.deltaE00(red, red, mode)).toBe(0);
      expect(color.deltaE00(red, green, mode)).toBeCloseTo(color.deltaE00(green, red, mode), 10);
    }
  });
});
