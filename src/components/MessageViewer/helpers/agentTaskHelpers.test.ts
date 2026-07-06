import { describe, expect, it } from "vitest";
import type { ClaudeMessage } from "../../../types";
import { filterParallelTaskMessages } from "./agentTaskHelpers";

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

describe("filterParallelTaskMessages", () => {
  it("returns the original messages when Parallel Tasks are enabled", () => {
    const messages = [makeMessage("normal", { content: "hello" })];

    expect(filterParallelTaskMessages(messages, true)).toBe(messages);
  });

  it("removes standalone task-notification cards", () => {
    const notification = makeMessage("notification", {
      content: "<task-notification><task-id>agent-1</task-id></task-notification>",
    });
    const normal = makeMessage("normal", { content: "keep me" });

    expect(filterParallelTaskMessages([notification, normal], false)).toEqual([normal]);
  });

  it("keeps a single-agent task because its card is labelled Agent", () => {
    const launch = makeMessage("launch", {
      toolUseResult: {
        isAsync: true,
        agentId: "agent-1",
        description: "Run a check",
      },
    });

    expect(filterParallelTaskMessages([launch], false)).toEqual([launch]);
  });

  it("removes launches and completions belonging to a multi-agent task group", () => {
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

    expect(filterParallelTaskMessages(
      [firstLaunch, secondLaunch, normal, completion],
      false,
    )).toEqual([normal]);
  });
});
