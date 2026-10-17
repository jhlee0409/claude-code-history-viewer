/**
 * DOM keyboard shortcuts for manifest commands (plan §4.4).
 *
 * One window listener serves every command. A shortcut has one owner per
 * runtime: in the WebUI it is this listener; in the desktop app, where the
 * native menu owns a command's shortcut (`ownedByNativeMenu`, from the menu
 * bridge in `nativeMenu.ts`), this listener skips it and the menu item runs
 * it. A command's `shortcutAlias` (⌘+ beside ⌘=) is a key the menu cannot
 * match, so this listener always runs it. Either way the command runs through `runCommand`, the same `enabled`
 * check the palette and the menu use.
 *
 * A key is left alone - not handled, not prevented - when:
 * - another handler already took it (`defaultPrevented`); this is also why a
 *   second listener (a duplicated hook, StrictMode's re-run) cannot run the
 *   command twice: the first run prevents the event;
 * - an IME is composing (`isComposing`, or keyCode 229 from WebKit);
 * - focus is in a text field or a modal dialog, unless the command says its
 *   shortcut works there (`keys.inFields` / `keys.inDialogs`). In a text
 *   field only a ⌘ / Ctrl chord can: a chord of ⌥ (and ⇧) alone is typing
 *   there - macOS ⌥+letter types a character or starts a dead key (⌥W `∑`,
 *   ⌥E accent), ⌥⇧←→ select by word - so the WebUI's ⌥ tab keys never fire
 *   in a field, whatever the command says;
 * - the command cannot run here, so the browser keeps its default (⌘F stays
 *   the browser's find outside a conversation).
 *
 * One exception: a key the native menu owns, pressed in a field or dialog
 * its command does not work in, is prevented (run by no one). Left alone it
 * would reach the menu item, which does not know where focus is - ⌘[ would
 * go back from the sidebar filter, ⌘T open a tab behind the palette.
 */
import { matchesChord, parseAccelerator, shortcutFor, type Chord, type KeyEnvironment } from "./keys";
import type { CommandId } from "./manifest";
import { isCommandEnabled, runCommand, type AppCommand, type CommandContext } from "./registry";

export interface ShortcutHandlerOptions {
  commands: readonly AppCommand[];
  env: KeyEnvironment;
  getContext: () => CommandContext;
  /**
   * Whether the native menu runs this command's shortcut right now; the
   * listener then leaves the key alone (no run, no preventDefault) so the
   * menu item gets it - one run per key press.
   */
  ownedByNativeMenu?: (id: CommandId) => boolean;
}

const FIELD_SELECTOR = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const DIALOG_SELECTOR = "[role='dialog'], [role='alertdialog']";

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest(FIELD_SELECTOR) !== null;
}

const isInDialog = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(DIALOG_SELECTOR) !== null;

export const isComposing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;

interface Binding {
  command: AppCommand;
  chord: Chord;
  /** The menu item's own key (not an alias): the native menu may own it. */
  menuKey: boolean;
}

/** A chord a text field may give up: one with ⌘ or Ctrl. ⌥ / ⇧ alone type there. */
const isCommandChord = (chord: Chord): boolean => chord.meta || chord.ctrl;

/** Whether `binding` may run while focus is in a text field. */
const runsInFields = ({ command, chord }: Binding): boolean => Boolean(command.keys?.inFields) && isCommandChord(chord);

/** The chords each command is bound to in `env`: its shortcut, then its alias. */
export function bindingsFor(commands: readonly AppCommand[], env: KeyEnvironment): Binding[] {
  return commands.flatMap((command) => {
    const bindings: Binding[] = [];
    const accelerator = shortcutFor(command.shortcut, env);
    if (accelerator) bindings.push({ command, chord: parseAccelerator(accelerator, env.os), menuKey: true });
    const alias = shortcutFor(command.shortcutAlias ?? null, env);
    if (alias) bindings.push({ command, chord: parseAccelerator(alias, env.os), menuKey: false });
    return bindings;
  });
}

export function createShortcutHandler({
  commands,
  env,
  getContext,
  ownedByNativeMenu,
}: ShortcutHandlerOptions): (event: KeyboardEvent) => void {
  const bindings = bindingsFor(commands, env);
  return (event) => {
    if (event.defaultPrevented || isComposing(event)) return;
    const binding = bindings.find(({ chord }) => matchesChord(event, chord));
    if (!binding) return;
    const { command } = binding;
    const notHere =
      (!runsInFields(binding) && isEditableTarget(event.target)) ||
      (!command.keys?.inDialogs && isInDialog(event.target));
    if (binding.menuKey && ownedByNativeMenu?.(command.id)) {
      // The menu item does not know where focus is: keep the key from it
      // where the command does not work (⌘[ in a field, ⌘T behind a dialog).
      if (notHere) event.preventDefault();
      return;
    }
    if (notHere) return;
    const ctx = getContext();
    if (!isCommandEnabled(command, ctx)) return;
    event.preventDefault();
    runCommand(command.id, ctx);
  };
}
