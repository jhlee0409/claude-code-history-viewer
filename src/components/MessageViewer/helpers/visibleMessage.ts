import type { VirtualItem } from "@tanstack/react-virtual";
import type { FlattenedMessage } from "../types";

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
  const row = virtualRows.find(
    (item) =>
      item.start + item.size > scrollTop &&
      item.size > 0 &&
      flattenedMessages[item.index]?.type === "message",
  );
  if (!row) return null;
  const item = flattenedMessages[row.index];
  return item?.type === "message" ? item.message.uuid : null;
}
