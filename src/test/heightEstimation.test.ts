import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../types";
import type { FlattenedMessage } from "../components/MessageViewer/types";
import {
  estimateMessageHeight,
  isZeroHeightMessageRow,
} from "../components/MessageViewer/helpers/heightEstimation";

const makeMessage = (
  overrides: Partial<ClaudeMessage> = {},
): ClaudeMessage =>
  ({
    type: "user",
    role: "user",
    uuid: "message-1",
    sessionId: "session-1",
    timestamp: "2026-06-13T00:00:00.000Z",
    content: "hello",
    ...overrides,
  }) as ClaudeMessage;

const makeFlattenedMessage = (
  message: ClaudeMessage,
  overrides: Partial<Extract<FlattenedMessage, { type: "message" }>> = {},
): Extract<FlattenedMessage, { type: "message" }> => ({
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
});

describe("message height estimation", () => {
  it("treats sidechain rows as zero-height outside subagent views", () => {
    const item = makeFlattenedMessage(makeMessage({ isSidechain: true }));

    expect(isZeroHeightMessageRow(item, false)).toBe(true);
    expect(estimateMessageHeight(item, false)).toBe(0);
  });

  it("keeps sidechain rows visible inside subagent views", () => {
    const item = makeFlattenedMessage(makeMessage({ isSidechain: true }));

    expect(isZeroHeightMessageRow(item, true)).toBe(false);
    expect(estimateMessageHeight(item, true)).toBeGreaterThan(0);
  });

  it("treats empty rows as zero-height", () => {
    const item = makeFlattenedMessage(
      makeMessage({
        content: "",
      }),
    );

    expect(isZeroHeightMessageRow(item)).toBe(true);
    expect(estimateMessageHeight(item)).toBe(0);
  });

  it("scales assistant message estimates with long text content", () => {
    const shortHeight = estimateMessageHeight(
      makeFlattenedMessage(
        makeMessage({
          type: "assistant",
          role: "assistant",
          content: "short",
        } as Partial<ClaudeMessage>),
      ),
    );
    const longHeight = estimateMessageHeight(
      makeFlattenedMessage(
        makeMessage({
          type: "assistant",
          role: "assistant",
          content: "line\n".repeat(180),
        } as Partial<ClaudeMessage>),
      ),
    );

    expect(longHeight).toBeGreaterThan(shortHeight + 500);
  });

  it("scales tool-result estimates with nested payload content", () => {
    const height = estimateMessageHeight(
      makeFlattenedMessage(
        makeMessage({
          type: "assistant",
          role: "assistant",
          toolUseResult: {
            content: "tool output\n".repeat(220),
          },
        } as Partial<ClaudeMessage>),
      ),
    );

    expect(height).toBeGreaterThan(900);
  });
});
