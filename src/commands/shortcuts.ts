/**
 * DOM keyboard shortcuts for manifest commands (plan §4.4).
 *
 * One window listener serves every command. A shortcut has one owner per
 * runtime: in the WebUI it is this listener; on the desktop, once the native
 * menu owns a command (T11a passes those ids as `nativeOwned`), this listener
 * skips it. Either way the command runs through `runCommand`, the same
 * `enabled` check the palette and the menu use.
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
 */
import { matchesChord, parseAccelerator, shortcutFor, type Chord, type KeyEnvironment } from "./keys";
import type { CommandId } from "./manifest";
import { isCommandEnabled, runCommand, type AppCommand, type CommandContext } from "./registry";

export interface ShortcutHandlerOptions {
  commands: readonly AppCommand[];
  env: KeyEnvironment;
  getContext: () => CommandContext;
  /** Commands whose shortcut the native menu owns on this runtime. */
  nativeOwned?: ReadonlySet<CommandId>;
}

/**
 * Commands the desktop's native menu owns, whose shortcut this listener
 * skips there. Empty until the native menu exists (T11a builds it from the
 * manifest and fills this from the menu it actually built).
 */
export const NATIVE_MENU_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>();

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
}

/** A chord a text field may give up: one with ⌘ or Ctrl. ⌥ / ⇧ alone type there. */
const isCommandChord = (chord: Chord): boolean => chord.meta || chord.ctrl;

/** Whether `binding` may run while focus is in a text field. */
const runsInFields = ({ command, chord }: Binding): boolean => Boolean(command.keys?.inFields) && isCommandChord(chord);

/** The chord each command is bound to in `env`. */
export function bindingsFor(commands: readonly AppCommand[], env: KeyEnvironment): Binding[] {
  return commands.flatMap((command) => {
    const accelerator = shortcutFor(command.shortcut, env);
    return accelerator ? [{ command, chord: parseAccelerator(accelerator, env.os) }] : [];
  });
}

export function createShortcutHandler({
  commands,
  env,
  getContext,
  nativeOwned,
}: ShortcutHandlerOptions): (event: KeyboardEvent) => void {
  const bindings = bindingsFor(commands, env);
  return (event) => {
    if (event.defaultPrevented || isComposing(event)) return;
    const binding = bindings.find(({ chord }) => matchesChord(event, chord));
    if (!binding) return;
    const { command } = binding;
    if (nativeOwned?.has(command.id)) return;
    if (!runsInFields(binding) && isEditableTarget(event.target)) return;
    if (!command.keys?.inDialogs && isInDialog(event.target)) return;
    const ctx = getContext();
    if (!isCommandEnabled(command, ctx)) return;
    event.preventDefault();
    runCommand(command.id, ctx);
  };
}
