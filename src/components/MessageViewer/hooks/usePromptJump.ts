/**
 * usePromptJump Hook
 *
 * Alt+ArrowUp / Alt+ArrowDown move the message list to the previous or next
 * turn start (a typed prompt or a slash-command invocation) among the loaded
 * rows. It works whether or not the Messages panel is open.
 */

import { useEffect } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { WebUINavigationOptions } from "@/utils/webuiDeepLink";
import type { FlattenedMessage } from "../types";
import { findTurnStartIndex, type TurnJumpDirection } from "../helpers/promptJump";

/**
 * A row ending this close to the top counts as scrolled past. After a jump the
 * target sits at the top give or take subpixel rounding, and the row above it
 * must not count as the row in view.
 */
const TOP_EDGE_TOLERANCE_PX = 2;

interface UsePromptJumpOptions {
  flattenedMessages: readonly FlattenedMessage[];
  virtualizer: Virtualizer<HTMLElement, Element>;
  getScrollElement: () => HTMLElement | null;
  /** The message a jump is still scrolling to, if any. */
  targetMessageUuid: string | null;
  navigateToMessage: (uuid: string, options?: WebUINavigationOptions) => void;
}

function directionForKey(key: string): TurnJumpDirection | null {
  if (key === "ArrowUp") return "previous";
  if (key === "ArrowDown") return "next";
  return null;
}

/**
 * Leave the keys alone in text fields (Alt+Arrow moves by word or line there)
 * and inside dialogs, where the message list is behind the modal.
 */
function isIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='alertdialog']",
    ) !== null
  );
}

export function usePromptJump({
  flattenedMessages,
  virtualizer,
  getScrollElement,
  targetMessageUuid,
  navigateToMessage,
}: UsePromptJumpOptions): void {
  useEffect(() => {
    // Step from a jump that is still scrolling; otherwise from the top row in view.
    const referenceIndex = (): number => {
      if (targetMessageUuid) {
        const targetIndex = flattenedMessages.findIndex(
          (item) => item.type === "message" && item.message.uuid === targetMessageUuid,
        );
        if (targetIndex !== -1) return targetIndex;
      }
      const scrollTop = getScrollElement()?.scrollTop ?? 0;
      const firstInView = virtualizer
        .getVirtualItems()
        .find(
          (row) =>
            row.start + row.size > scrollTop + TOP_EDGE_TOLERANCE_PX &&
            flattenedMessages[row.index]?.type === "message",
        );
      return firstInView?.index ?? -1;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const direction = directionForKey(event.key);
      if (!direction || isIgnoredTarget(event.target)) return;

      const index = findTurnStartIndex(flattenedMessages, referenceIndex(), direction);
      const item = index === null ? undefined : flattenedMessages[index];
      if (item?.type !== "message") return;

      event.preventDefault();
      // Replace, not push: a run of jumps should not fill the back button's history.
      navigateToMessage(item.message.uuid, { history: "replace" });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flattenedMessages, virtualizer, getScrollElement, targetMessageUuid, navigateToMessage]);
}
