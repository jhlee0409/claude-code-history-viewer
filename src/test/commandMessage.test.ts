import { describe, expect, it } from "vitest";
import {
  formatCommandMessageText,
  parseCommandMessage,
} from "../utils/commandMessage";

describe("parseCommandMessage", () => {
  it("extracts name, message and args", () => {
    const parsed = parseCommandMessage(
      "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>PR 42</command-args>",
    );
    expect(parsed.command).toEqual({
      name: "/review",
      message: "review is running…",
      args: "PR 42",
    });
    expect(parsed.remainingText).toBe("");
  });

  it("drops a message that only repeats the command name", () => {
    const parsed = parseCommandMessage(
      "<command-name>/cost</command-name><command-message>cost</command-message><command-args></command-args>",
    );
    expect(parsed.command).toEqual({ name: "/cost", message: undefined, args: undefined });
  });

  it("collects local stdout, caveats, outputs and remaining text", () => {
    const parsed = parseCommandMessage(
      "<local-command-caveat>Caveat: x</local-command-caveat><local-command-stdout>Total: $1</local-command-stdout><bash-stdout>ok</bash-stdout><bash-stderr>bad</bash-stderr>\nrest",
    );
    expect(parsed.caveats).toEqual(["Caveat: x"]);
    expect(parsed.localStdout).toEqual(["Total: $1"]);
    expect(parsed.outputs).toEqual([
      { type: "stdout", name: "bash-stdout", content: "ok" },
      { type: "stderr", name: "bash-stderr", content: "bad" },
    ]);
    expect(parsed.remainingText).toBe("rest");
  });
});

describe("formatCommandMessageText (session board card text)", () => {
  const RAW_TAG = /<\/?(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>/;

  it.each([
    [
      "slash command with args",
      "<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>PR 42</command-args>",
      "/review PR 42",
    ],
    [
      "slash command without args",
      "<command-name>/cost</command-name>\n<command-message>cost</command-message>\n<command-args></command-args>",
      "/cost",
    ],
    [
      "local command stdout",
      "<local-command-stdout>Total cost: $0.42</local-command-stdout>",
      "Total cost: $0.42",
    ],
    [
      "local command stdout with ANSI codes",
      "<local-command-stdout>\u001b[1mCompacted\u001b[22m</local-command-stdout>",
      "Compacted",
    ],
    [
      "caveat only",
      "<local-command-caveat>Caveat: generated locally.</local-command-caveat>",
      "Caveat: generated locally.",
    ],
  ])("shows %s without raw tags", (_label, raw, expected) => {
    const text = formatCommandMessageText(raw);
    expect(text).toBe(expected);
    expect(text).not.toMatch(RAW_TAG);
  });

  it("leaves text without command tags untouched", () => {
    const plain = "Use <div> and <output>x</output> literally";
    expect(formatCommandMessageText(plain)).toBe(plain);
  });
});
