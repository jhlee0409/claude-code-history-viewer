import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn with the type tokens", () => {
  it("keeps a type token next to a text colour (not merged as a colour)", () => {
    for (const size of ["caption", "list", "body", "code", "title"]) {
      expect(cn(`text-${size} text-muted-foreground`)).toBe(`text-${size} text-muted-foreground`);
    }
  });

  it("still resolves size conflicts: the later size wins", () => {
    expect(cn("text-caption", "text-list")).toBe("text-list");
    expect(cn("text-body", "text-2xl")).toBe("text-2xl");
  });
});
