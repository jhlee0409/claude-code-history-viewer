import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import {
  filterMessagesByCategory,
  getMessageUuidsByCategory,
} from "./messageCategories";

const makeMessage = (
  uuid: string,
  overrides: Record<string, unknown>,
): ClaudeMessage => ({
  uuid,
  type: "user",
  role: "user",
  timestamp: "2026-07-07T00:00:00.000Z",
  content: "",
  ...overrides,
} as unknown as ClaudeMessage);

describe("parallel-task message category", () => {
  it("returns the original messages when the category is included", () => {
    const messages = [makeMessage("normal", { content: "hello" })];

    expect(filterMessagesByCategory(messages, "parallel-task", true)).toBe(messages);
  });

  it("categorizes and removes standalone task-notification cards", () => {
    const notification = makeMessage("notification", {
      content: "<task-notification><task-id>agent-1</task-id></task-notification>",
    });
    const normal = makeMessage("normal", { content: "keep me" });
    const messages = [notification, normal];

    expect(getMessageUuidsByCategory(messages, "parallel-task")).toEqual(
      new Set(["notification"]),
    );
    expect(filterMessagesByCategory(messages, "parallel-task", false)).toEqual([normal]);
  });

  it("keeps a single-agent task because its card is labelled Agent", () => {
    const launch = makeMessage("launch", {
      toolUseResult: {
        isAsync: true,
        agentId: "agent-1",
        description: "Run a check",
      },
    });

    expect(getMessageUuidsByCategory([launch], "parallel-task")).toEqual(new Set());
  });

  it("categorizes launches and completions in a multi-agent task group", () => {
    const firstLaunch = makeMessage("launch-1", {
      toolUseResult: {
        isAsync: true,
        agentId: "agent-1",
        description: "Run the first parallel check",
      },
    });
    const secondLaunch = makeMessage("launch-2", {
      timestamp: "2026-07-07T00:00:01.000Z",
      toolUseResult: {
        isAsync: true,
        agentId: "agent-2",
        description: "Run the second parallel check",
      },
    });
    const completion = makeMessage("completion", {
      timestamp: "2026-07-07T00:00:02.000Z",
      toolUseResult: {
        agentId: "agent-1",
        status: "completed",
      },
    });
    const normal = makeMessage("normal", { content: "keep me" });
    const messages = [firstLaunch, secondLaunch, normal, completion];

    expect(getMessageUuidsByCategory(messages, "parallel-task")).toEqual(
      new Set(["launch-1", "launch-2", "completion"]),
    );
    expect(filterMessagesByCategory(messages, "parallel-task", false)).toEqual([normal]);
  });
});
