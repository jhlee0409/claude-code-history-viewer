import { describe, expect, it } from "vitest";
import { getModelLifecycle } from "./calculations";

// Local-time constructors: lifecycle compares against the user's calendar day.
const today = new Date(2026, 8, 2, 12);

describe("getModelLifecycle", () => {
  it("returns null for ids the table does not know", () => {
    expect(getModelLifecycle("totally-unknown-model", today)).toBeNull();
  });

  it("reports active models without a shutdown date", () => {
    expect(getModelLifecycle("claude-sonnet-4-6", today)).toEqual({ status: "active" });
  });

  it("reports a model past its shutdown date as retired with the replacement", () => {
    expect(getModelLifecycle("claude-opus-4-1-20250805", today)).toEqual({
      status: "retired",
      deprecatedAt: "2026-08-05",
      replacedBy: "claude-opus-4-8",
    });
  });

  it("reports a shutdown inside the notice window as retiring", () => {
    expect(getModelLifecycle("o4-mini", today)).toMatchObject({ status: "retiring", deprecatedAt: "2026-10-23" });
  });

  it("treats a shutdown beyond the notice window as active", () => {
    expect(getModelLifecycle("gemini-3.1-flash-lite", today)).toMatchObject({ status: "active", deprecatedAt: "2027-05-07" });
  });

  it("flips to retired on the shutdown date itself", () => {
    expect(getModelLifecycle("o4-mini", new Date(2026, 9, 23, 0, 0))?.status).toBe("retired");
    expect(getModelLifecycle("o4-mini", new Date(2026, 9, 22, 23, 59))?.status).toBe("retiring");
  });

  it("ignores the billing provider gate so subscription sessions still get a status", () => {
    expect(getModelLifecycle("copilot/gpt-5-codex", today)?.status).toBe("retired");
  });
});
