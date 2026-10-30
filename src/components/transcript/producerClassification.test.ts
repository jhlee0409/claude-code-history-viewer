import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "@/types";
import type { FlattenedMessageItem } from "../MessageViewer/types";
import { classifyMessage } from "../MessageViewer/helpers/messageKinds";
import { findTurnStartIndex } from "../MessageViewer/helpers/promptJump";
import { getFilteredClassifiedMessages } from "../MessageNavigator/classifiedRows";
import { groupTurns } from "../MessageNavigator/outline/groupTurns";
import { transcriptBlocks } from "./transcriptBlocks";

// Synthetic text only. Producer citations and verified limits: transcript-items.md.
const cases = [
  ['<codex_internal_context source="user_goal">synthetic goal</codex_internal_context>', "context"],
  ["<recommended_plugins>synthetic plugin</recommended_plugins>", "context"],
  ["<turn_aborted>synthetic interruption</turn_aborted>", "context"],
  ["<bash-stdout>synthetic output</bash-stdout><bash-stderr></bash-stderr>", "command"],
  ["<bash-stderr>synthetic error</bash-stderr>", "command"],
] as const;
const user = (uuid: string, content: string): ClaudeMessage => ({ uuid, sessionId: "synthetic", timestamp: "2026-01-01T12:00:00Z", type: "user", role: "user", content });
const row = (message: ClaudeMessage): FlattenedMessageItem => ({ type: "message", message, depth: 0, originalIndex: 0, isGroupLeader: false, isGroupMember: false, isProgressGroupLeader: false, isProgressGroupMember: false, isTaskOperationGroupLeader: false, isTaskOperationGroupMember: false, isContinuation: false });

describe("producer-backed classification consumers", () => {
  it.each(cases)("classifies %s without splitting navigator, jump or pure-model turns", (text, kind) => {
    const messages = [user("first", "Synthetic typed prompt"), user("generated", text), user("last", "Synthetic next prompt")];
    expect(classifyMessage(messages[1]).kind).toBe(kind);
    const classified = getFilteredClassifiedMessages(messages);
    // Existing empty-message filtering removes bash wrappers before classifying.
    expect(classified.map(r => r.entry.kind)).toEqual(kind === "command" ? ["prompt", "prompt"] : ["prompt", kind, "prompt"]);
    expect(groupTurns(classified).map(t => t.turnStartUuid)).toEqual(["first", "last"]);
    expect(findTurnStartIndex(messages.map(row), 0, "next")).toBe(2);
    expect(findTurnStartIndex(messages.map(row), 2, "previous")).toBe(0);
    expect(transcriptBlocks(row(messages[1])).map(b => b.kind)).toEqual(["notice"]);
  });

  it.each([
    '<codex_internal_context source="extension">synthetic</codex_internal_context>',
    '<codex_internal_context source="user_goal">synthetic</codex_internal_context><environment_context>synthetic</environment_context>',
  ])("accepts registered internal source wrappers: %s", text => {
    expect(classifyMessage(user("context", text)).kind).toBe("context");
  });

  it.each([
    '<codex_internal_context source="Extension">synthetic</codex_internal_context>',
    '<codex_internal_context_other>synthetic</codex_internal_context_other>',
    '<codex_internal_context source="user_goal">unterminated',
    '<codex_internal_context source="user_goal">synthetic</codex_internal_context> Synthetic typed suffix',
    '<project_context>synthetic</project_context>',
  ])("does not hide unregistered, malformed or mixed typed text: %s", text => {
    expect(classifyMessage(user("typed", text)).kind).toBe("prompt");
  });
});
