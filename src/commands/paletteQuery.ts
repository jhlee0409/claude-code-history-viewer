/**
 * How the ⌘K palette finds and names commands.
 */
import type { CommandId } from "./manifest";
import { isCommandEnabled, paletteCommands, type AppCommand, type CommandContext } from "./registry";

/**
 * A palette item value as cmdk stores it: cmdk 1.1.1 trims an item's value
 * before writing its `data-value` (and the root's controlled value), so a
 * value is built and looked up in that form, or one ending in whitespace
 * (a message id) names no option.
 */
export const paletteValue = (value: string): string => value.trim();

/** cmdk item value of a command; message results use another prefix. */
export const commandItemValue = (id: CommandId): string => `command:${id}`;

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/**
 * The words of a title or a query, lowercased: split at whitespace, `/` and
 * an ellipsis (`…` or `...`), plus each camelCase word's parts, so a title
 * pasted whole ("Send Feedback…", "macOS") finds itself.
 */
function wordsOf(text: string): string[] {
  const words = text.split(/[\s/…]+|\.{3,}/).filter(Boolean);
  const parts = words.flatMap((word) => word.replace(/([a-z])([A-Z])/g, "$1 $2").split(" "));
  return [...new Set([...words, ...parts].map((word) => word.toLocaleLowerCase()))];
}

/**
 * Whether `query` picks this title: every word of the query starts a word of
 * the title (or of the id), so "set" finds "Open Settings Manager" but a
 * message search for "et" does not drag in every title containing "et".
 * Japanese and Chinese titles have no spaces, so a CJK word matches anywhere
 * in the title. Query and title are split into words the same way
 * (`wordsOf`).
 */
export function matchesCommandQuery(query: string, title: string, id: string): boolean {
  const words = query.trim().split(/[\s/…]+|\.{3,}/).filter(Boolean).map((word) => word.toLocaleLowerCase());
  if (words.length === 0) return true;
  const haystack = wordsOf(`${title} ${id.replace(/[.]/g, " ")}`);
  const lowerTitle = title.toLocaleLowerCase();
  return words.every((word) =>
    CJK.test(word) ? lowerTitle.includes(word) : haystack.some((candidate) => candidate.startsWith(word)),
  );
}

export interface PaletteEntry {
  command: AppCommand;
  title: string;
  enabled: boolean;
}

/** The commands the palette shows for `query`, in manifest order. */
export function paletteEntries(
  query: string,
  ctx: CommandContext,
  translate: (key: string) => string,
): PaletteEntry[] {
  return paletteCommands(ctx)
    .map((command) => ({ command, title: translate(command.labelKey), enabled: isCommandEnabled(command, ctx) }))
    .filter(({ command, title }) => matchesCommandQuery(query, title, command.id));
}
