import { stripAnsiCodes } from "./ansiToHtml";

/**
 * Parsing of Claude Code slash-command / local-command message markup
 * (`<command-name>`, `<command-message>`, `<command-args>`,
 * `<local-command-stdout>`, `<local-command-caveat>`, `*stdout*`/`*stderr*`
 * output tags). Shared by the transcript `CommandRenderer` and the session
 * board so both read the same markup the same way.
 */

export interface CommandGroup {
  name?: string;
  message?: string;
  args?: string;
}

export interface CommandOutputTag {
  type: "stdout" | "stderr" | "other";
  name: string;
  content: string;
}

export interface ParsedCommandMessage {
  command: CommandGroup;
  /** Generic output tags (`*stdout*`/`*output*`, `*stderr*`/`*error*`), excluding local-command-stdout. */
  outputs: CommandOutputTag[];
  caveats: string[];
  /** `<local-command-stdout>` blocks (user-visible command output, e.g. /cost). */
  localStdout: string[];
  /** Text left after removing every recognised tag. */
  remainingText: string;
}

const KNOWN_COMMAND_TAG =
  /<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>/;

/** True when the text carries Claude Code command markup. */
export const hasCommandTags = (text: string): boolean => KNOWN_COMMAND_TAG.test(text);

const extractFirst = (text: string, regex: RegExp, tag: string): string | undefined =>
  text.match(regex)?.[0]?.replace(new RegExp(`</?${tag}>`, "g"), "").trim();

const collectContents = (text: string, regex: RegExp): string[] => {
  const blocks: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [, content] = match;
    if (content && content.trim()) blocks.push(content.trim());
  }
  return blocks;
};

const collectOutputs = (
  text: string,
  regex: RegExp,
  type: CommandOutputTag["type"],
): CommandOutputTag[] => {
  const outputs: CommandOutputTag[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [, tagName, content] = match;
    if (content && content.trim()) {
      outputs.push({ type, name: tagName ?? "", content: content.trim() });
    }
  }
  return outputs;
};

export function parseCommandMessage(text: string): ParsedCommandMessage {
  // Regexes are created per call: they are global and stateful (lastIndex).
  const commandNameRegex = /<command-name>\s*(.*?)\s*<\/command-name>/gs;
  const commandMessageRegex = /<command-message>\s*(.*?)\s*<\/command-message>/gs;
  const commandArgsRegex = /<command-args>\s*(.*?)\s*<\/command-args>/gs;
  // stdout family: any tag containing stdout/output (local-command-stdout is handled separately)
  const stdoutRegex = /<(?!local-command-stdout)([^>]*(?:stdout|output)[^>]*)\s*>\s*(.*?)\s*<\/\1>/gs;
  // stderr family: any tag containing stderr/error
  const stderrRegex = /<([^>]*(?:stderr|error)[^>]*)\s*>\s*(.*?)\s*<\/\1>/gs;
  const caveatRegex = /<local-command-caveat>\s*(.*?)\s*<\/local-command-caveat>/gs;
  const localStdoutRegex = /<local-command-stdout>\s*(.*?)\s*<\/local-command-stdout>/gs;

  const name = extractFirst(text, commandNameRegex, "command-name");
  const message = extractFirst(text, commandMessageRegex, "command-message");
  const args = extractFirst(text, commandArgsRegex, "command-args");

  // Hide message if it's just the command name without slash (e.g., name="/cost", message="cost")
  const isRedundantMessage = name && message && name.replace(/^\//, "") === message;

  const command: CommandGroup = {
    name: name && name.length > 0 ? name : undefined,
    message: message && message.length > 0 && !isRedundantMessage ? message : undefined,
    args: args && args.length > 0 ? args : undefined,
  };

  const outputs = [
    ...collectOutputs(text, stdoutRegex, "stdout"),
    ...collectOutputs(text, stderrRegex, "stderr"),
  ];
  const caveats = collectContents(text, caveatRegex);
  const localStdout = collectContents(text, localStdoutRegex);

  const remainingText = text
    .replace(commandNameRegex, "")
    .replace(commandMessageRegex, "")
    .replace(commandArgsRegex, "")
    .replace(stdoutRegex, "")
    .replace(stderrRegex, "")
    .replace(caveatRegex, "")
    .replace(localStdoutRegex, "")
    .replace(/^\s*\n/gm, "")
    .trim();

  return { command, outputs, caveats, localStdout, remainingText };
}

/**
 * Plain one-glance text for a command message (session board cards):
 * "/command args", the command's stdout, any remaining text; caveats only when
 * nothing else is present. Text without command markup is returned unchanged.
 */
export function formatCommandMessageText(text: string): string {
  if (!hasCommandTags(text)) return text;

  const { command, outputs, caveats, localStdout, remainingText } = parseCommandMessage(text);
  const head = [command.name ?? command.message, command.args].filter(Boolean).join(" ");
  const parts = [
    head,
    ...localStdout.map(stripAnsiCodes),
    ...outputs.map((output) => output.content),
    remainingText,
  ].filter((part) => part.length > 0);

  return (parts.length > 0 ? parts : caveats).join("\n");
}
