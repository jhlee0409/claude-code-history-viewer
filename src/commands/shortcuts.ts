/**
 * DOM keyboard shortcuts for manifest commands (plan §4.4).
 *
 * One window listener serves every command, and it is the only owner of
 * every app shortcut, in every runtime. A command runs through
 * `dispatchCommand`: the one command queue the palette and the menu use too
 * (so a key waits behind menu events the journal is still fetching), and the
 * same `enabled` check. Whether the key is taken is decided now, from the
 * current state; the command runs in its turn, usually at once.
 *
 * The Mac app's native menu items carry the same accelerators
 * (`MENU_ACCELERATORS`). Measured in the real app
 * (docs/adr/0001-native-menu-input-ownership.md): the web view sees a ⌘ key before the
 * menu, and a key the page prevents never reaches the menu item. So there the
 * listener **claims** (prevents) every app key it matches - whether it runs
 * it or not - and the item's accelerator only shows the key. No key depends
 * on the native item's enabled state, which is an asynchronous copy. A key
 * reaches a menu item only when no page listens (mid-reload); the menu
 * journal (`menuJournal.ts`) then runs it once, in order.
 *
 * A key is not run - and, outside the Mac app, left alone (not prevented) -
 * when:
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
 * A command whose keys the web view itself handles in this environment
 * (`keys.byEngine`: WebView2's zoom keys on Windows) is not bound at all.
 */
import { matchesChord, parseAccelerator, shortcutFor, type Chord, type KeyEnvironment } from "./keys";
import { MENU_ACCELERATORS } from "./manifest";
import { dispatchCommand, isCommandEnabled, type AppCommand, type CommandContext } from "./registry";
import type { CommandQueue } from "./commandQueue";

export interface ShortcutHandlerOptions {
  commands: readonly AppCommand[];
  env: KeyEnvironment;
  getContext: () => CommandContext;
  /** Where its commands run (default: the app's one command queue). */
  queue?: CommandQueue;
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

/** Whether native menu items carry the app keys in `env`: the page then claims each key it matches. */
export const menuCarriesAppKeys = (env: KeyEnvironment): boolean =>
  env.runtime === "desktop" && MENU_ACCELERATORS[env.os];

interface Binding {
  command: AppCommand;
  chord: Chord;
}

/** A chord a text field may give up: one with ⌘ or Ctrl. ⌥ / ⇧ alone type there. */
const isCommandChord = (chord: Chord): boolean => chord.meta || chord.ctrl;

/** Whether `binding` may run while focus is in a text field. */
const runsInFields = ({ command, chord }: Binding): boolean => Boolean(command.keys?.inFields) && isCommandChord(chord);

/** The chords each command is bound to in `env`: its shortcut, then its alias. */
export function bindingsFor(commands: readonly AppCommand[], env: KeyEnvironment): Binding[] {
  return commands.flatMap((command) => {
    if (command.keys?.byEngine?.(env)) return [];
    const bindings: Binding[] = [];
    for (const set of [command.shortcut, command.shortcutAlias ?? null]) {
      const accelerator = shortcutFor(set, env);
      if (accelerator) bindings.push({ command, chord: parseAccelerator(accelerator, env.os) });
    }
    return bindings;
  });
}

export function createShortcutHandler({
  commands,
  env,
  getContext,
  queue,
}: ShortcutHandlerOptions): (event: KeyboardEvent) => void {
  const bindings = bindingsFor(commands, env);
  const claimsMatchedKeys = menuCarriesAppKeys(env);
  return (event) => {
    if (event.defaultPrevented) return;
    const binding = bindings.find(({ chord }) => matchesChord(event, chord));
    if (!binding) return;
    // In the Mac app a key left alone would go on to the menu item, which
    // knows neither focus nor composition: claim it whether it runs or not.
    if (claimsMatchedKeys) event.preventDefault();
    if (isComposing(event)) return;
    const { command } = binding;
    if (!runsInFields(binding) && isEditableTarget(event.target)) return;
    if (!command.keys?.inDialogs && isInDialog(event.target)) return;
    if (!isCommandEnabled(command, getContext())) return;
    event.preventDefault();
    dispatchCommand(command.id, getContext, queue);
  };
}
