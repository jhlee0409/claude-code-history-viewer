/**
 * Step navigation within a turn (#783): the previous or next assistant step
 * of the turn in view - an assistant reply (text or thinking), a tool call
 * with the result merged into it, or a tool result whose call is not loaded.
 *
 * Turns are the Messages panel outline's (#632): the same classified rows and
 * `groupTurns`, so a step never crosses a boundary the outline draws.
 */
import type { VirtualItem } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "../../../types";
import type { StepDirection } from "@/commands/stepTarget";
import { getFilteredClassifiedMessages } from "../../MessageNavigator/classifiedRows";
import { groupTurns } from "../../MessageNavigator/outline/groupTurns";
import { LEADING_TURN_KEY } from "../../MessageNavigator/outline/types";
import type { FlattenedMessage, FlattenedMessageItem } from "../types";
import { isZeroHeightMessageRow } from "./heightEstimation";
import { classifyMessage } from "./messageKinds";

/** How much of a row must show below the top edge before it counts as in view (`visibleMessage.ts`). */
const IN_VIEW_TOLERANCE_PX = 16;
/**
 * A row starting further above the top edge than this has its head scrolled
 * out of view. After a jump the target's start sits at the top, give or take
 * subpixel rounding, and must not count as scrolled.
 */
const SCROLLED_PAST_TOLERANCE_PX = 2;

export interface StepTurns {
  /** Each loaded message's turn key; a row the outline drops joins the turn before it. */
  turnOf: ReadonlyMap<string, string>;
  /** The rows that start a turn: a prompt is the turn, not a step in it. */
  starts: ReadonlySet<string>;
}

/** The outline's turns over `messages`, as lookups for stepping. */
export function buildStepTurns(messages: ClaudeMessage[]): StepTurns {
  const turns = groupTurns(getFilteredClassifiedMessages(messages));
  const turnOf = new Map<string, string>();
  const starts = new Set<string>();
  for (const turn of turns) {
    if (turn.turnStartUuid) starts.add(turn.turnStartUuid);
    for (const uuid of turn.uuids) turnOf.set(uuid, turn.key);
  }
  // Noise and empty rows are not in the outline; they belong to the turn they sit in.
  let current = LEADING_TURN_KEY;
  for (const message of messages) {
    const key = turnOf.get(message.uuid);
    if (key === undefined) turnOf.set(message.uuid, current);
    else current = key;
  }
  return { turnOf, starts };
}

/** A shown row that is an assistant step. Folded group members and hidden rows are not. */
export function isStepRow(
  item: FlattenedMessage | undefined,
  turns: StepTurns,
  isInSubagent: boolean,
): item is FlattenedMessageItem {
  if (item?.type !== "message" || isZeroHeightMessageRow(item, isInSubagent)) return false;
  const { message } = item;
  if (turns.starts.has(message.uuid)) return false;
  return message.type === "assistant" || classifyMessage(message).kind === "tool";
}

export interface StepReference {
  /** Index of the row being read, in the flattened rows. */
  index: number;
  /** Its head is above the viewport: stepping back lands on its own start first. */
  scrolledPast: boolean;
}

/**
 * The row being read: the first message row showing more than a sliver below
 * the top edge (`findFirstVisibleMessageUuid`'s rule), or null before any row
 * is laid out.
 */
export function findStepReference(
  virtualRows: readonly VirtualItem[],
  rows: readonly FlattenedMessage[],
  scrollTop: number,
): StepReference | null {
  const firstEndingPast = (edge: number) =>
    virtualRows.find(
      (item) => item.size > 0 && item.start + item.size > edge && rows[item.index]?.type === "message",
    );
  const row = firstEndingPast(scrollTop + IN_VIEW_TOLERANCE_PX) ?? firstEndingPast(scrollTop);
  if (!row) return null;
  return { index: row.index, scrolledPast: row.start < scrollTop - SCROLLED_PAST_TOLERANCE_PX };
}

/**
 * Index of the nearest step before or after the reference row within its
 * turn, or null at the turn's first or last step. From the turn's prompt,
 * "next" is the turn's first step.
 */
export function findStepIndex(
  rows: readonly FlattenedMessage[],
  reference: StepReference,
  direction: StepDirection,
  turns: StepTurns,
  isInSubagent: boolean,
): number | null {
  const referenceRow = rows[reference.index];
  if (referenceRow?.type !== "message") return null;
  const turn = turns.turnOf.get(referenceRow.message.uuid);
  if (turn === undefined) return null;
  const isTarget = (index: number) => {
    const item = rows[index];
    return isStepRow(item, turns, isInSubagent) && turns.turnOf.get(item.message.uuid) === turn;
  };

  if (direction === "next") {
    for (let index = reference.index + 1; index < rows.length; index++) {
      if (isTarget(index)) return index;
    }
    return null;
  }
  if (reference.scrolledPast && isTarget(reference.index)) return reference.index;
  for (let index = reference.index - 1; index >= 0; index--) {
    if (isTarget(index)) return index;
  }
  return null;
}
