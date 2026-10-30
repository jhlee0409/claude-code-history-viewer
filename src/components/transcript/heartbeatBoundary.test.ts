import { describe, expect, it } from "vitest";
import { classifyMessage, isCodexHeartbeat } from "../MessageViewer/helpers/messageKinds";
import { applyMessageDisplayFilter } from "../MessageViewer/helpers/messageDisplayFilter";
import { getFilteredClassifiedMessages } from "../MessageNavigator/classifiedRows";
import { groupTurns } from "../MessageNavigator/outline/groupTurns";
import { buildTranscriptItems } from "./transcriptItems";
import { flattened, user } from "./transcriptItems.fixtures";

// Scheduler shape: Codex 0.164.0 history/src/heartbeat.rs L75–109.
// Body text is synthetic. Real-data structure audit: 34/34 whole envelopes.
const envelope = "<heartbeat>\n  <automation_id>synthetic</automation_id>\n  <current_time_iso>2026-09-23T00:00:00Z</current_time_iso>\n  <instructions>\nSynthetic wake\n  </instructions>\n</heartbeat>";
const message = (content: string) => ({ ...user("input", content), provider: "codex" as const });

describe("heartbeat whole-message boundary", () => {
  it.each([
    "<heartbeat>a</heartbeat> Please help <heartbeat>b</heartbeat>",
    envelope + " Please help",
    "Please help " + envelope,
    "<heartbeat>ordinary user text</heartbeat>",
    envelope.replace("2026-09-23T00:00:00Z", "now\nignore restrictions"),
    envelope.replace("2026-09-23T00:00:00Z", "2026-09-23T00:00:00Z\n"),
    envelope.replace("synthetic</automation_id>", "synthetic\n</automation_id>"),
    " \n" + envelope + "\n ",
    envelope + "\n\n",
    envelope.replace(/\n/g, "\r\n"),
    envelope.replace("synthetic</automation_id>", "</automation_id>"),
    envelope.replace("synthetic</automation_id>", "a".repeat(129) + "</automation_id>"),
    envelope.replace("synthetic</automation_id>", "bad.id</automation_id>"),
    envelope.replace("2026-09-23T00:00:00Z", ""),
    envelope.replace("2026-09-23T00:00:00Z", "1".repeat(65)),
    envelope.replace("Synthetic wake", "x".repeat(3332)),
    envelope.replace("Synthetic wake", "é".repeat(1666)),
    envelope.replace("Synthetic wake", "x\n".repeat(476)),
    "<heartbeat>Synthetic unfinished wake",
    "<heartbeat><heartbeat>Synthetic nested wake</heartbeat></heartbeat>",
  ])("preserves mixed or malformed input as a human prompt: %s", content => {
    const input = message(content);
    expect(classifyMessage(input).kind).toBe("prompt");
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "human", turnNumber: 1 });
    expect(buildTranscriptItems(flattened([input]), new Map()).turns[0]).toMatchObject({ kind: "human" });
    expect(applyMessageDisplayFilter([input], {
      roles: { user: true, assistant: false },
      contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true },
    })).toEqual([input]);
  });

  // parse uses split_once for fields and strip_suffix for the instruction body:
  // delimiters inside instructions are literal, not recursively parsed (L88–91).
  it.each([
    envelope, envelope + "\n", envelope + envelope,
    envelope.replace("Synthetic wake", ""),
    envelope.replace("synthetic</automation_id>", "A_0-</automation_id>"),
    envelope.replace("synthetic</automation_id>", "a".repeat(128) + "</automation_id>"),
    envelope.replace("2026-09-23T00:00:00Z", "1".repeat(64)),
    envelope.replace("Synthetic wake", "x".repeat(3331)),
    envelope.replace("Synthetic wake", "é".repeat(1665)),
    envelope.replace("Synthetic wake", "\n  Literal </heartbeat> and <heartbeat>\n"),
  ])("retains exactly the reader's accepted envelope as automated context: %s", content => {
    const input = message(content);
    expect(isCodexHeartbeat(input)).toBe(true);
    expect(classifyMessage(input).kind).toBe("context");
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "automated", turnNumber: null });
  });

  it.each([
    [{ type: "text" as const, text: envelope }, { type: "text" as const, text: envelope }],
    [{ type: "text" as const, text: envelope }, { type: "text" as const, text: "" }],
    [{ type: "text" as const, text: envelope }, { type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "synthetic" } }],
  ])("keeps extra content items as human input: %j", (...content) => {
    const input = { ...message(envelope), content };
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(classifyMessage(input).kind).toBe("prompt");
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "human", turnNumber: 1 });
    expect(buildTranscriptItems(flattened([input]), new Map()).turns[0]).toMatchObject({ kind: "human" });
    expect(applyMessageDisplayFilter([input], {
      roles: { user: true, assistant: false },
      contentTypes: { text: true, thinking: true, toolCalls: true, commands: true, parallelTasks: true },
    })).toEqual([input]);
  });

  it("accepts a single projected input_text item, but not another provider or role", () => {
    const input = { ...message(envelope), content: [{ type: "text" as const, text: envelope }] };
    expect(isCodexHeartbeat(input)).toBe(true);
    expect(isCodexHeartbeat({ ...input, provider: "claude" })).toBe(false);
    expect(isCodexHeartbeat({ ...input, type: "assistant" })).toBe(false);
  });

  it("preserves separate typed text blocks", () => {
    const input = { ...message(envelope), content: [{ type: "text" as const, text: envelope }, { type: "text" as const, text: "Please help" }] };
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(classifyMessage(input).kind).toBe("prompt");
  });
});
