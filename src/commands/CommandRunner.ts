/**
 * Running app commands from UI controls (plan T7): the toolbar's back /
 * forward, inspector and palette buttons and the sidebar's library rows run
 * the same registry commands as the shortcuts and the ⌘K palette, through
 * `runCommand` and its one `enabled` check. No control adds a shortcut of its
 * own.
 *
 * The context carries the live command-context getter (`useCommandContext`),
 * provided once by the app shell. Without a provider (a component rendered on
 * its own in a test) commands are refused and report disabled.
 */
import { createContext, useContext, useMemo } from "react";
import { getCommand, isCommandEnabled, runCommand, type CommandContext } from "./registry";
import type { CommandId } from "./manifest";

export const CommandRunnerContext = createContext<(() => CommandContext) | null>(null);

export interface CommandRunner {
  /** Run a command; false when it is unknown, unavailable or disabled. */
  run: (id: CommandId) => boolean;
  /** Whether the command could run right now. */
  isEnabled: (id: CommandId) => boolean;
}

export function useCommandRunner(): CommandRunner {
  const getContext = useContext(CommandRunnerContext);
  return useMemo(
    () => ({
      run: (id) => (getContext ? runCommand(id, getContext()) : false),
      isEnabled: (id) => {
        const command = getCommand(id);
        return Boolean(getContext && command && isCommandEnabled(command, getContext()));
      },
    }),
    [getContext]
  );
}
