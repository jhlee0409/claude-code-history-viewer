import { describe, expect, it } from "vitest";
import type { ClaudeMessage, ContentItem } from "../../../types";
import type { MessageFilter } from "../../../store/slices/filterSlice";
import { assistant, tool, user } from "../../transcript/transcriptItems.fixtures";
import { applyMessageDisplayFilter } from "./messageDisplayFilter";

const contentTypes = { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true };
const both = { user: true, assistant: true };
const outline = (overrides: Partial<MessageFilter> = {}): MessageFilter => ({
  roles: both,
  contentTypes,
  promptsAndFinalReplies: true,
  ...overrides,
});
const uuids = (messages: ClaudeMessage[]) => messages.map((message) => message.uuid);

const text = (uuid: string, value = `${uuid} text`) => assistant(uuid, [{ type: "text", text: value }] as ContentItem[]);
const thinking = (uuid: string) => assistant(uuid, [{ type: "thinking", thinking: "synthetic" }] as ContentItem[]);
const notification = (uuid: string) => ({
  ...user(uuid, "<task-notification><task-id>synthetic</task-id><status>completed</status><summary>Synthetic notification</summary></task-notification>"),
  provider: "claude" as const,
});

describe("applyMessageDisplayFilter: prompts and final replies", () => {
  it("keeps each typed prompt and only the last text reply before the next prompt", () => {
    const messages = [
      user("p1"),
      thinking("t1"),
      text("progress", "Checking the files first."),
      tool("read1"),
      text("final1"),
      user("p2"),
      tool("read2"),
      text("final2"),
    ];
    expect(uuids(applyMessageDisplayFilter(messages, outline()))).toEqual(["p1", "final1", "p2", "final2"]);
  });

  it("keeps a prompt whose turn ended without any text reply", () => {
    const messages = [user("p1"), tool("read1"), user("p2"), text("final2")];
    expect(uuids(applyMessageDisplayFilter(messages, outline()))).toEqual(["p1", "p2", "final2"]);
  });

  it("does not end a turn at an agent update and hides the update itself", () => {
    const messages = [user("p1"), text("early"), notification("update"), text("after-update"), user("p2")];
    expect(uuids(applyMessageDisplayFilter(messages, outline()))).toEqual(["p1", "after-update", "p2"]);
  });

  it("treats a slash command as a prompt", () => {
    const messages = [
      user("cmd", "<command-name>/review</command-name>\n<command-args></command-args>"),
      text("draft"),
      text("review-final"),
    ];
    expect(uuids(applyMessageDisplayFilter(messages, outline()))).toEqual(["cmd", "review-final"]);
  });

  it("ignores sub-agent messages in the main session but uses them inside the sub-agent", () => {
    const side = (message: ClaudeMessage) => ({ ...message, isSidechain: true });
    // A background sub-agent can finish after the main reply; its text must not replace it.
    const messages = [user("p1"), text("final1"), side(user("task-prompt")), side(text("task-final"))];
    expect(uuids(applyMessageDisplayFilter(messages, outline()))).toEqual(["p1", "final1"]);

    const subagent = [side(user("task-prompt")), side(text("task-draft")), side(text("task-final"))];
    expect(uuids(applyMessageDisplayFilter(subagent, outline(), { inSubagent: true }))).toEqual(["task-prompt", "task-final"]);
  });

  it("narrows the role filters instead of overriding them", () => {
    const messages = [user("p1"), text("progress"), text("final1"), user("p2"), text("final2")];
    expect(uuids(applyMessageDisplayFilter(messages, outline({ roles: { user: true, assistant: false } })))).toEqual(["p1", "p2"]);
    expect(uuids(applyMessageDisplayFilter(messages, outline({ roles: { user: false, assistant: true } })))).toEqual(["final1", "final2"]);
  });

  it("leaves the list untouched when the toggle is off or absent", () => {
    const messages = [user("p1"), text("progress"), text("final1")];
    expect(applyMessageDisplayFilter(messages, outline({ promptsAndFinalReplies: false }))).toEqual(messages);
    expect(applyMessageDisplayFilter(messages, { roles: both, contentTypes })).toEqual(messages);
  });
});
