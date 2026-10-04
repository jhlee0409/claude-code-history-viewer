import { isMacOS } from "../../../utils/platform";
import type { FlattenedMessage } from "../types";
import { classifyMessage, startsUserTurn } from "./messageKinds";

export type TurnJumpDirection = "previous" | "next";

/** Keys shown wherever the prompt-jump shortcut is described. */
export function getPromptJumpKeysLabel(): string {
  return isMacOS() ? "⌥↑ / ⌥↓" : "Alt+↑ / Alt+↓";
}

/** A visible message row that starts a user turn. Group members are folded into their leader. */
function isTurnStartRow(item: FlattenedMessage | undefined): boolean {
  if (item?.type !== "message") return false;
  if (item.isGroupMember || item.isProgressGroupMember || item.isTaskOperationGroupMember) {
    return false;
  }
  return startsUserTurn(classifyMessage(item.message));
}

/**
 * Index of the nearest turn start before or after `referenceIndex`, or null
 * when there is none in the loaded rows. Going back from inside a turn lands
 * on that turn's own start.
 */
export function findTurnStartIndex(
  rows: readonly FlattenedMessage[],
  referenceIndex: number,
  direction: TurnJumpDirection,
): number | null {
  if (direction === "next") {
    for (let index = referenceIndex + 1; index < rows.length; index++) {
      if (isTurnStartRow(rows[index])) return index;
    }
    return null;
  }
  for (let index = Math.min(referenceIndex, rows.length) - 1; index >= 0; index--) {
    if (isTurnStartRow(rows[index])) return index;
  }
  return null;
}
