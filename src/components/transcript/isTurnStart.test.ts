import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { isTurnStart } from "./isTurnStart";

const user = (content: ClaudeMessage["content"], extra = {}): ClaudeMessage => ({ uuid: "u", sessionId: "s", timestamp: "2026-01-01T12:00:00Z", type: "user", role: "user", content, ...extra });
describe("producer-grounding review repros (synthetic only)", () => {
  it.each([
    ["R1 bash output", user("<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>"), false],
    ["R1b bash input", user("<bash-input>ls</bash-input>"), true],
    ["R2 internal context with source attribute", user([{ type: "text", text: '<codex_internal_context source="user_goal">g</codex_internal_context>' }]), false],
    ["R3 aborted-turn context", user([{ type: "text", text: "<turn_aborted>x</turn_aborted>" }]), false],
    ["R4 recommendations plus environment", user([{ type: "text", text: "<recommended_plugins>p</recommended_plugins>" }, { type: "text", text: "<environment_context>e</environment_context>" }]), false],
    ["R5 environment control", user([{ type: "text", text: "<environment_context>e</environment_context>" }]), false],
    // Owner decision: notification cycles start an automated, not human, turn.
    ["R6 task-notification automated cycle", user("<task-notification>synthetic update</task-notification>"), true],
    // UNGROUNDED: pin the existing fallback without claiming it matches the producer.
    ["R7 main-view result plus image fallback", user([{ type: "image", source: { type: "url", url: "https://example.invalid/synthetic.png" } }], { toolUseResult: { type: "image" } }), true],
  ])("%s", (_name, message, expected) => {
    expect(isTurnStart(message, { inSubagent: false })).toBe(expected);
  });
});

describe("index-compatible turn-start predicate", () => {
  it.each([
    ["plain prompt", user("hello"), false, true],
    ["image prompt", user([{ type: "image", source: { type: "url", url: "x" } }]), false, true],
    ["result beside image prompt", user([{ type: "tool_result", tool_use_id: "t", content: "ok" }, { type: "image", source: { type: "url", url: "x" } }]), true, true],
    ["result only", user([{ type: "tool_result", tool_use_id: "t", content: "ok" }]), false, false],
    ["mixed directive", user([{ type: "tool_result", tool_use_id: "t", content: "ok" }, { type: "text", text: "next task" }]), true, true],
    ["meta", user("context", { isMeta: true }), false, false],
    ["caveat", user("<local-command-caveat>generated</local-command-caveat>"), false, false],
    ["slash invocation is a user turn, unlike its generated output", user("<command-name>/cost</command-name>"), false, true],
    ["local output", user("<local-command-stdout>1</local-command-stdout>"), false, false],
    ["task notification", user("<task-notification>done</task-notification>"), false, true],
    ["main sidechain", user("task", { isSidechain: true }), false, false],
    ["subagent sidechain", user("task", { isSidechain: true }), true, true],
    ["assistant", { ...user("reply"), type: "assistant", role: "assistant" } as ClaudeMessage, false, false],
  ])("%s", (_name, message, inSubagent, expected) => {
    expect(isTurnStart(message, { inSubagent })).toBe(expected);
  });
});
