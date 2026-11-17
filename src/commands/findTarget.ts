/**
 * The in-conversation find field, as a command target (`edit.find`, ⌘F).
 *
 * The conversation screen registers its search input while it is mounted; the
 * command focuses it. Last registration wins, and unregistering only removes
 * the caller's own registration, so a remount cannot drop a newer target.
 * While the screen shows its loading or empty state there is no input, and
 * the command is disabled.
 */
import { useEffect, type RefObject } from "react";

type InputGetter = () => HTMLInputElement | null;

let current: InputGetter | null = null;

export function registerFindTarget(getInput: InputGetter): () => void {
  current = getInput;
  return () => {
    if (current === getInput) current = null;
  };
}

const findInput = (): HTMLInputElement | null => {
  const input = current?.() ?? null;
  return input?.isConnected ? input : null;
};

export const hasFindTarget = (): boolean => findInput() !== null;

/** Focus and select the find field; false when none is on screen. */
export function focusFindTarget(): boolean {
  const input = findInput();
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

/** Register `ref`'s input as the find field while mounted. */
export function useFindTarget(ref: RefObject<HTMLInputElement | null>): void {
  useEffect(() => registerFindTarget(() => ref.current), [ref]);
}
