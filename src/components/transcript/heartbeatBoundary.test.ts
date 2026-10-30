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
    envelope + envelope,
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

  it.each([envelope, " \n" + envelope + "\n ", "<heartbeat>Synthetic wake</heartbeat>"])("retains a complete single envelope as automated context: %s", content => {
    const input = message(content);
    expect(isCodexHeartbeat(input)).toBe(true);
    expect(classifyMessage(input).kind).toBe("context");
    expect(groupTurns(getFilteredClassifiedMessages([input]))[0]).toMatchObject({ kind: "automated", turnNumber: null });
  });

  it("preserves separate typed text blocks", () => {
    const input = { ...message(envelope), content: [{ type: "text" as const, text: envelope }, { type: "text" as const, text: "Please help" }] };
    expect(isCodexHeartbeat(input)).toBe(false);
    expect(classifyMessage(input).kind).toBe("prompt");
  });
});
