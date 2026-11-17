import { describe, expect, it } from "vitest";
import { classifyMessage } from "../MessageViewer/helpers/messageKinds";
import { getFilteredClassifiedMessages } from "../MessageNavigator/classifiedRows";
import { groupTurns } from "../MessageNavigator/outline/groupTurns";
import { findTurnStartIndex } from "../MessageViewer/helpers/promptJump";
import { flattened, user } from "./transcriptItems.fixtures";
import { turnStartKind } from "./isTurnStart";

// Synthetic text; Claude Code 2.1.285 emits output in its own user record.
// Binary emitter receipt and local-record limits: transcript-items.md.
describe("bash output whole-message boundary", () => {
  it.each([
    "<bash-stdout>Synthetic output</bash-stdout> Please explain this",
    "<bash-stderr>Synthetic error</bash-stderr> Please help",
    "<bash-stdout>a</bash-stdout> Please explain <bash-stderr>b</bash-stderr>",
    "<bash-stdout>Synthetic unfinished output",
    "Please explain <bash-stdout>Synthetic output</bash-stdout>",
  ])("retains typed or malformed output text as a human prompt: %s", content => {
    const messages = [user("first"), user("mixed", content), user("last")];
    expect(classifyMessage(messages[1]).kind).toBe("prompt");
    expect(turnStartKind(messages[1], { inSubagent: false })).toBe("human");
    const rows = getFilteredClassifiedMessages(messages).filter(row => row.info.kind === "prompt" || row.info.kind === "command");
    expect(rows.map(row => row.entry.uuid)).toEqual(["first", "mixed", "last"]);
    expect(groupTurns(rows).map(group => group.turnStartUuid)).toEqual(["first", "mixed", "last"]);
    expect(findTurnStartIndex(flattened(messages), 0, "next")).toBe(1);
  });

  it.each([
    "<bash-stdout>Synthetic output</bash-stdout><bash-stderr></bash-stderr>",
    " \n<bash-stdout>Synthetic output\nsecond line</bash-stdout>\n<bash-stderr>Synthetic error</bash-stderr> \n",
    "<bash-stdout>Synthetic output</bash-stdout>",
    "<bash-stderr>Synthetic error</bash-stderr>",
  ])("keeps complete output-only records as commands: %s", content => {
    const message = user("output", content);
    expect(classifyMessage(message).kind).toBe("command");
    expect(turnStartKind(message, { inSubagent: false })).toBeNull();
  });
});
