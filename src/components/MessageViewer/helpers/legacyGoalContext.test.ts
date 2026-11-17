import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import { classifyMessage } from "./messageKinds";
import { turnStartKind } from "../../transcript/isTurnStart";

// Historical emitter: 522f549922f6e7b8edbd5e9be3fc720ddb9b256a,
// context/goal_context.rs L20–36 + goals.rs L1599–1601 (see contract).
const message = (content: string) => ({
  uuid: "legacy-goal", type: "user", role: "user", provider: "codex",
  timestamp: "2026-09-26T06:29:32.477Z", content,
}) as ClaudeMessage;

describe("producer-emitted legacy goal context", () => {
  it("is injected context, not human input or a new automated-cycle policy", () => {
    const input = message("<goal_context>\nSynthetic runtime steering.\n</goal_context>");
    expect(classifyMessage(input).kind).toBe("context");
    expect(turnStartKind(input, { inSubagent: false })).toBeNull();
  });
  it.each([
    "<goal_context>unfinished",
    "<goal_context>runtime</goal_context> Synthetic typed residue",
    "Synthetic typed prefix <goal_context>runtime</goal_context>",
    "<goal_context source=\"unknown\">runtime</goal_context>",
  ])("preserves human/unknown text: %s", content => {
    expect(classifyMessage(message(content)).kind).toBe("prompt");
  });
});
