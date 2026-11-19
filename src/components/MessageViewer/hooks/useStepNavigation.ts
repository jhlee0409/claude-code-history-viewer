/**
 * useStepNavigation Hook
 *
 * Registers the message list as the target of the step commands
 * (`go.previousStep` / `go.nextStep`, `src/commands/stepTarget.ts`): move to
 * the previous or next assistant step of the turn in view among the loaded
 * rows (`helpers/stepJump.ts`). The keys, palette entries and menu items are
 * the command registry's; this hook only answers them.
 */

import { useCallback, useEffect, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "@/types";
import type { WebUINavigationOptions } from "@/utils/webuiDeepLink";
import { useStepTarget, type StepDirection } from "@/commands/stepTarget";
import type { FlattenedMessage } from "../types";
import { buildStepTurns, findStepIndex, findStepReference, type StepReference, type StepTurns } from "../helpers/stepJump";

interface UseStepNavigationOptions {
  /** The session's loaded messages, unfiltered: turns are grouped over them as in the outline. */
  messages: ClaudeMessage[];
  flattenedMessages: readonly FlattenedMessage[];
  virtualizer: Virtualizer<HTMLElement, Element>;
  getScrollElement: () => HTMLElement | null;
  /** The message a jump is still scrolling to, if any. */
  targetMessageUuid: string | null;
  navigateToMessage: (uuid: string, options?: WebUINavigationOptions) => void;
  isInSubagent: boolean;
}

export function useStepNavigation(options: UseStepNavigationOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  // Grouped on the first step after the messages change, not on every render.
  const turnsCache = useRef<{ messages: ClaudeMessage[]; turns: StepTurns } | null>(null);

  const step = useCallback((direction: StepDirection): boolean => {
    const { messages, flattenedMessages, virtualizer, getScrollElement, targetMessageUuid, navigateToMessage, isInSubagent } =
      latest.current;
    const scrollElement = getScrollElement();
    if (!scrollElement) return false;

    if (turnsCache.current?.messages !== messages) {
      turnsCache.current = { messages, turns: buildStepTurns(messages) };
    }
    const { turns } = turnsCache.current;

    // Step from a jump that is still scrolling (it may target a row not yet
    // rendered); otherwise from the row in view.
    const targetIndex = targetMessageUuid
      ? flattenedMessages.findIndex((item) => item.type === "message" && item.message.uuid === targetMessageUuid)
      : -1;
    const reference: StepReference | null =
      targetIndex === -1
        ? findStepReference(virtualizer.getVirtualItems(), flattenedMessages, scrollElement.scrollTop)
        : { index: targetIndex, scrolledPast: false };
    if (!reference) return false;

    const index = findStepIndex(flattenedMessages, reference, direction, turns, isInSubagent);
    const item = index === null ? undefined : flattenedMessages[index];
    if (item?.type !== "message") return false;
    // Replace, not push: a run of steps should not fill the back button's history.
    navigateToMessage(item.message.uuid, { history: "replace" });
    return true;
  }, []);

  useStepTarget(step);
}
