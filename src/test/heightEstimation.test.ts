/**
 * Regression tests for estimateMessageHeight (issue #334).
 *
 * A subagent session is rendered entirely from `isSidechain` messages whose
 * hide-rule is bypassed (ClaudeMessageNode renders them at full height when
 * `parentSessionStack.length > 0`). The height estimate must therefore NOT
 * collapse those rows to 0 — otherwise the virtualizer believes the whole list
 * has ~0 total height, mounts every row at once, and a large subagent session
 * (e.g. 259 messages) triggers a measurement storm / React #185 crash.
 */

import { describe, expect, it } from "vitest";
import { estimateMessageHeight } from "../components/MessageViewer/helpers/heightEstimation";
import type { FlattenedMessage, FlattenedMessageItem } from "../components/MessageViewer/types";
import type { ClaudeMessage } from "../types";

const makeMessage = (
  overrides: Partial<ClaudeMessage> & { isSidechain: boolean }
): ClaudeMessage =>
  ({
    type: "assistant",
    uuid: "u1",
    parentUuid: null,
    sessionId: "sess",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "assistant", content: "hello" },
    ...overrides,
  }) as unknown as ClaudeMessage;

const makeItem = (
  message: ClaudeMessage,
  overrides: Partial<FlattenedMessageItem> = {}
): FlattenedMessage =>
  ({
    type: "message",
    message,
    depth: 0,
    originalIndex: 0,
    isGroupLeader: false,
    isGroupMember: false,
    isProgressGroupLeader: false,
    isProgressGroupMember: false,
    isTaskOperationGroupLeader: false,
    isTaskOperationGroupMember: false,
    ...overrides,
  }) as FlattenedMessageItem;

describe("estimateMessageHeight — sidechain rows in subagent sessions (#334)", () => {
  it("collapses sidechain rows to 0 in a normal session (hide-rule applies)", () => {
    const item = makeItem(makeMessage({ isSidechain: true }));
    // Default (isInSubagent omitted) and explicit false both estimate 0.
    expect(estimateMessageHeight(item)).toBe(0);
    expect(estimateMessageHeight(item, false)).toBe(0);
  });

  it("gives sidechain rows a real estimate inside a subagent session", () => {
    const item = makeItem(makeMessage({ type: "assistant", isSidechain: true }));
    const height = estimateMessageHeight(item, true);
    // Must be the assistant type estimate (180), never the hidden 0 that causes
    // the virtualizer to mount the entire list at once.
    expect(height).toBeGreaterThan(0);
    expect(height).toBe(180);
  });

  it("estimates a sidechain user row at its user height in a subagent session", () => {
    const item = makeItem(makeMessage({ type: "user", isSidechain: true }));
    expect(estimateMessageHeight(item, true)).toBe(120);
  });

  it("still collapses group-member rows to 0 even inside a subagent session", () => {
    // Group members are always hidden regardless of subagent context.
    const item = makeItem(makeMessage({ isSidechain: true }), {
      isGroupMember: true,
    });
    expect(estimateMessageHeight(item, true)).toBe(0);
  });

  it("does not change non-sidechain estimates", () => {
    const assistant = makeItem(makeMessage({ type: "assistant", isSidechain: false }));
    expect(estimateMessageHeight(assistant, false)).toBe(180);
    expect(estimateMessageHeight(assistant, true)).toBe(180);
  });
});
