import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import { isTurnStart } from "./isTurnStart";

const user = (content: ClaudeMessage["content"], extra = {}): ClaudeMessage => ({ uuid: "u", sessionId: "s", timestamp: "2026-01-01T12:00:00Z", type: "user", role: "user", content, ...extra });
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
    ["task notification", user("<task-notification>done</task-notification>"), false, false],
    ["main sidechain", user("task", { isSidechain: true }), false, false],
    ["subagent sidechain", user("task", { isSidechain: true }), true, true],
    ["assistant", { ...user("reply"), type: "assistant", role: "assistant" } as ClaudeMessage, false, false],
  ])("%s", (_name, message, inSubagent, expected) => {
    expect(isTurnStart(message, { inSubagent })).toBe(expected);
  });
});
