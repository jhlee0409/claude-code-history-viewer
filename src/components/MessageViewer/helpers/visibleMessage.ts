import type { VirtualItem } from "@tanstack/react-virtual";
import type { FlattenedMessage } from "../types";

/** How much of a row must show below the top edge before it counts as in view. */
const TOP_EDGE_TOLERANCE_PX = 16;

/**
 * The uuid of the first message row currently scrolled into view, following
 * the same `row.start + row.size > scrollTop` form as `handleLoadEarlier`
 * (`MessageViewer.tsx`) and the prompt jump (`promptJump.ts`), with an added
 * `size > 0` guard so a collapsed (height-0) group member can never be
 * reported as the visible row. Pure, so the outline's "message currently
 * visible in the main transcript" tracking (Design, "Highlighting the turn
 * in view") is testable without mounting `MessageViewer`.
 */
export function findFirstVisibleMessageUuid(
  virtualRows: readonly VirtualItem[],
  flattenedMessages: readonly FlattenedMessage[],
  scrollTop: number,
): string | null {
  const firstEndingPast = (edge: number) =>
    virtualRows.find(
      (item) =>
        item.start + item.size > edge &&
        item.size > 0 &&
        flattenedMessages[item.index]?.type === "message",
    );
  // A row showing less than the tolerance is not the one being read.
  // Navigation aligns its target with the top edge, and fractional heights
  // can leave the row above it "visible" by under a pixel, which handed the
  // highlight to the previous turn. Fall back to the plain rule at the very
  // end of the list, where a peeking row may be all that is left.
  const row = firstEndingPast(scrollTop + TOP_EDGE_TOLERANCE_PX) ?? firstEndingPast(scrollTop);
  if (!row) return null;
  const item = flattenedMessages[row.index];
  return item?.type === "message" ? item.message.uuid : null;
}
