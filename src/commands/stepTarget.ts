/**
 * The transcript's step navigation, as a command target (`go.previousStep`,
 * `go.nextStep`).
 *
 * The message list registers a stepper while it is mounted; the commands call
 * it. Last registration wins, and unregistering only removes the caller's own
 * registration, so a remount cannot drop a newer target (as `findTarget.ts`).
 */
import { useEffect } from "react";
import { COMMAND_MANIFEST } from "./manifest";
import { currentKeyEnvironment, shortcutLabel, type KeyEnvironment } from "./keys";

export type StepDirection = "previous" | "next";

/** Move the message list one step in `direction`; false when there is none. */
export type Stepper = (direction: StepDirection) => boolean;

let current: Stepper | null = null;

export function registerStepTarget(stepper: Stepper): () => void {
  current = stepper;
  return () => {
    if (current === stepper) current = null;
  };
}

export const hasStepTarget = (): boolean => current !== null;

/** Step the registered message list; false when none is mounted or it has no step that way. */
export const stepInTurn = (direction: StepDirection): boolean => current?.(direction) ?? false;

/** Register `stepper` while mounted. It may change identity per render; the latest one runs. */
export function useStepTarget(stepper: Stepper): void {
  useEffect(() => registerStepTarget(stepper), [stepper]);
}

/** The step keys where the app runs (`⌘⌥↑ / ⌘⌥↓`), from the manifest, for hints. */
export function getStepKeysLabel(env: KeyEnvironment = currentKeyEnvironment()): string {
  const label = (id: string) => {
    const entry = COMMAND_MANIFEST.find((command) => command.id === id);
    return entry ? shortcutLabel(entry.shortcut, env) : null;
  };
  return [label("go.previousStep"), label("go.nextStep")].filter(Boolean).join(" / ");
}
