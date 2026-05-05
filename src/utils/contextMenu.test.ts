import { describe, it, expect } from "vitest";
import { computeMenuPosition, type Boundary } from "./contextMenu";

const boundary: Boundary = { left: 0, top: 0, right: 400, bottom: 800 };
const menu = { width: 200, height: 120 };

describe("computeMenuPosition", () => {
  it("returns the cursor when the menu fits inside the boundary", () => {
    expect(
      computeMenuPosition({ x: 100, y: 100 }, menu, boundary),
    ).toEqual({ x: 100, y: 100 });
  });

  it("flips x when the cursor is near the boundary right edge", () => {
    // 250 + 200 = 450 > 400 - 8 → flip to 250 - 200 = 50
    expect(
      computeMenuPosition({ x: 250, y: 100 }, menu, boundary),
    ).toEqual({ x: 50, y: 100 });
  });

  it("flips y when the cursor is near the boundary bottom edge", () => {
    // 750 + 120 = 870 > 800 - 8 → flip to 750 - 120 = 630
    expect(
      computeMenuPosition({ x: 100, y: 750 }, menu, boundary),
    ).toEqual({ x: 100, y: 630 });
  });

  it("flips both axes when near the corner", () => {
    expect(
      computeMenuPosition({ x: 390, y: 790 }, menu, boundary),
    ).toEqual({ x: 190, y: 670 });
  });

  it("clamps to left edge with padding when the menu is wider than the boundary", () => {
    const narrow: Boundary = { left: 0, top: 0, right: 150, bottom: 800 };
    // menu.width 200 > 150 - 16 → flip produces negative, clamp pulls to left+padding
    const result = computeMenuPosition({ x: 80, y: 100 }, menu, narrow);
    expect(result.x).toBe(narrow.left + 8);
    expect(result.y).toBe(100);
  });

  it("clamps to top edge with padding when the menu is taller than the boundary", () => {
    const short: Boundary = { left: 0, top: 0, right: 400, bottom: 80 };
    const result = computeMenuPosition({ x: 100, y: 40 }, menu, short);
    expect(result.x).toBe(100);
    expect(result.y).toBe(short.top + 8);
  });

  it("falls back to the viewport when boundary is null", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    try {
      // cursor at 900, menu 200 → 1100 > 1000 - 8 → flip to 700
      const result = computeMenuPosition({ x: 900, y: 100 }, menu, null);
      expect(result).toEqual({ x: 700, y: 100 });
    } finally {
      Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
    }
  });

  it("respects a custom padding", () => {
    // padding = 20 → trigger flip at 250 + 200 = 450 > 400 - 20 = 380 (still flips)
    // clamp: max(0 + 20, min(50, 400 - 200 - 20)) = max(20, 50) = 50
    expect(
      computeMenuPosition({ x: 250, y: 100 }, menu, boundary, 20),
    ).toEqual({ x: 50, y: 100 });
  });

  it("keeps x within a sidebar-rooted boundary when the menu is wider than the panel", () => {
    // Simulates a narrow sidebar at left=20 (real apps with resizable panels)
    const sidebar: Boundary = { left: 20, top: 0, right: 180, bottom: 800 };
    const result = computeMenuPosition({ x: 120, y: 100 }, menu, sidebar);
    // menu.width 200 > 180 - 20 - 16 = 144 → flip goes negative, clamp pulls to left+padding
    expect(result.x).toBe(sidebar.left + 8);
    expect(result.x).toBeGreaterThan(0);
  });
});
