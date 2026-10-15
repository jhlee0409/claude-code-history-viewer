import { describe, expect, it } from "vitest";
import { SESSION_ITEM_HEIGHT, sessionItemHeight } from "./sessionItemHeight";

describe("sessionItemHeight", () => {
  it("is the base height at 100 % and below", () => {
    expect(sessionItemHeight(100)).toBe(SESSION_ITEM_HEIGHT);
    expect(sessionItemHeight(90)).toBe(SESSION_ITEM_HEIGHT);
  });

  it("grows with the font scale so scaled text never overlaps the next row", () => {
    expect(sessionItemHeight(110)).toBe(Math.ceil(SESSION_ITEM_HEIGHT * 1.1));
    expect(sessionItemHeight(130)).toBe(Math.ceil(SESSION_ITEM_HEIGHT * 1.3));
  });

  it("falls back to the base height for a non-finite scale", () => {
    expect(sessionItemHeight(Number.NaN)).toBe(SESSION_ITEM_HEIGHT);
  });
});
