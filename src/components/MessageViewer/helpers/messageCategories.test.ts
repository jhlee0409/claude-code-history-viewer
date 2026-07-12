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

  it("categorizes Codex collaboration tools only when a turn spawns multiple agents", () => {
    const prompt = makeMessage("prompt", {
      provider: "codex",
      content: [{ type: "text", text: "Run independent checks" }],
    });
    const firstSpawn = makeMessage("spawn-1", {
      provider: "codex",
      type: "assistant",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-spawn-1",
          name: "spawn_agent",
          input: { message: "Check the API" },
        },
        {
          type: "tool_result",
          tool_use_id: "call-spawn-1",
          content: '{"agent_id":"agent-1"}',
        },
      ],
    });
    const secondSpawn = makeMessage("spawn-2", {
      provider: "codex",
      type: "assistant",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "call-spawn-2",
        name: "spawn_agent",
        input: { message: "Check the UI" },
      }],
    });
    const wait = makeMessage("wait", {
      provider: "codex",
      type: "assistant",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "call-wait",
        name: "wait_agent",
        input: {},
      }],
    });
    const answer = makeMessage("answer", {
      provider: "codex",
      type: "assistant",
      role: "assistant",
      content: [{ type: "text", text: "Both checks passed" }],
    });
    const nextPrompt = makeMessage("next-prompt", {
      provider: "codex",
      content: [{ type: "text", text: "Run one more check" }],
    });
    const singleSpawn = makeMessage("single-spawn", {
      provider: "codex",
      type: "assistant",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "call-spawn-3",
        name: "spawn_agent",
        input: { message: "Check one thing" },
      }],
    });
    const messages = [
      prompt,
      firstSpawn,
      secondSpawn,
      wait,
      answer,
      nextPrompt,
      singleSpawn,
    ];

    expect(getMessageUuidsByCategory(messages, "parallel-task")).toEqual(
      new Set(["spawn-1", "spawn-2", "wait"]),
    );
    expect(filterMessagesByCategory(messages, "parallel-task", false)).toEqual([
      prompt,
      answer,
      nextPrompt,
      singleSpawn,
    ]);
  });

  it("categorizes a Gemini message with multiple recorded subagent calls", () => {
    const parallelAgents = makeMessage("gemini-agents", {
      provider: "gemini",
      type: "assistant",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "agent-call-1",
          name: "agent",
          agentId: "agent-1",
          input: { agent_name: "codebase_investigator", prompt: "Check API" },
        },
        {
          type: "tool_use",
          id: "agent-call-2",
          name: "agent",
          agentId: "agent-2",
          input: { agent_name: "codebase_investigator", prompt: "Check UI" },
        },
      ],
    });
    const singleAgent = makeMessage("gemini-single-agent", {
      provider: "gemini",
      type: "assistant",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "agent-call-3",
        name: "agent",
        agentId: "agent-3",
        input: { agent_name: "generalist", prompt: "Check one thing" },
      }],
    });
    const pendingParallelAgents = makeMessage("gemini-pending-agents", {
      provider: "gemini",
      type: "assistant",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "agent-call-4",
          name: "agent",
          input: { agent_name: "codebase_investigator", prompt: "Check API" },
        },
        {
          type: "tool_use",
          id: "agent-call-5",
          name: "agent",
          input: { agent_name: "generalist", prompt: "Check UI" },
        },
      ],
    });

    expect(getMessageUuidsByCategory(
      [parallelAgents, singleAgent, pendingParallelAgents],
      "parallel-task",
    )).toEqual(new Set(["gemini-agents", "gemini-pending-agents"]));
  });

  it("categorizes Qwen parallel Agent calls and their result message", () => {
    const parallelAgents = makeMessage("qwen-agents", {
      provider: "qwen",
      type: "assistant",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "agent-call-1",
          name: "agent",
          input: { description: "Check API", prompt: "Review the API" },
        },
        {
          type: "tool_use",
          id: "agent-call-2",
          name: "task",
          input: { description: "Check UI", prompt: "Review the UI" },
        },
      ],
    });
    const results = makeMessage("qwen-agent-results", {
      provider: "qwen",
      content: [
        { type: "tool_result", tool_use_id: "agent-call-1", content: "API OK" },
        { type: "tool_result", tool_use_id: "agent-call-2", content: "UI OK" },
      ],
    });
    const singleAgent = makeMessage("qwen-single-agent", {
      provider: "qwen",
      type: "assistant",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "agent-call-3",
        name: "agent",
        input: { description: "One check", prompt: "Review one thing" },
      }],
    });

    expect(getMessageUuidsByCategory(
      [parallelAgents, results, singleAgent],
      "parallel-task",
    )).toEqual(new Set(["qwen-agents", "qwen-agent-results"]));
  });

  it("categorizes an OpenCode message with multiple normalized Task calls", () => {
    const parallelTasks = makeMessage("opencode-tasks", {
      provider: "opencode",
      type: "assistant",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "task-call-1",
          name: "Task",
          input: { description: "Check API", prompt: "Review the API" },
        },
        {
          type: "tool_result",
          tool_use_id: "task-call-1",
          content: "API OK",
        },
        {
          type: "tool_use",
          id: "task-call-2",
          name: "Task",
          input: { description: "Check UI", prompt: "Review the UI" },
        },
        {
          type: "tool_result",
          tool_use_id: "task-call-2",
          content: "UI OK",
        },
      ],
    });
    const singleTask = makeMessage("opencode-single-task", {
      provider: "opencode",
      type: "assistant",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "task-call-3",
        name: "Task",
        input: { description: "One check", prompt: "Review one thing" },
      }],
    });

    expect(getMessageUuidsByCategory(
      [parallelTasks, singleTask],
      "parallel-task",
    )).toEqual(new Set(["opencode-tasks"]));
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
