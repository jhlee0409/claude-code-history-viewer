/**
 * The cmdk values of the palette's Messages group (`PaletteMessageGroup`),
 * kept apart from the component so the palette can compute its item list.
 */
import type { ClaudeMessage } from "@/types";
import { paletteValue } from "@/commands/paletteQuery";
import { MESSAGE_PREVIEW_LIMIT, MORE_MESSAGES_VALUE, RETRY_MESSAGES_VALUE } from "@/commands/paletteSources";
import type { MessageSearchView } from "./usePaletteMessageSearch";

/** cmdk value of the `index`-th result (cmdk trims values: `paletteValue`). */
export const messageItemValue = (index: number, result: ClaudeMessage): string =>
  paletteValue(`message:${index}:${result.uuid}`);

/** The results the group lists now. */
export function shownMessages(view: MessageSearchView, expanded: boolean): ClaudeMessage[] {
  if (view.status !== "done") return [];
  return expanded ? view.results : view.results.slice(0, MESSAGE_PREVIEW_LIMIT);
}

/** cmdk values of the group's items, in list order of first appearance. */
export function messageGroupValues(view: MessageSearchView, expanded: boolean): string[] {
  if (view.status === "error") return [RETRY_MESSAGES_VALUE];
  if (view.status !== "done") return [];
  const values = shownMessages(view, expanded).map((result, index) => messageItemValue(index, result));
  if (!expanded && view.results.length > MESSAGE_PREVIEW_LIMIT) values.push(MORE_MESSAGES_VALUE);
  return values;
}
