/**
 * The command registry (plan §4.4): the manifest plus what only the frontend
 * knows - the icon, whether the command applies here, whether it can run
 * now, and how it runs.
 *
 * Every route to a command - a DOM shortcut (`shortcuts.ts`), the ⌘K palette
 * and, from T11a, the native menu - goes through `runCommand`, so they share
 * one `enabled` check. A command runs through the app's own actions
 * (`navigate` via the screen switches, the store's toggles, the modal
 * context); the registry holds no state of its own.
 */
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Map as MinimapGlyph,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  SquareArrowRight,
  TextSearch,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import i18n from "i18next";
import type { PlaceOwner } from "@/navigation/ownership";
import type { Place } from "@/navigation/place";
import type { Runtime } from "./keys";
import { COMMAND_MANIFEST, type CommandId, type CommandManifestEntry } from "./manifest";

/** What a command needs to know and do. Built per use by `useCommandContext`. */
export interface CommandContext {
  place: Place;
  runtime: Runtime;
  isMobile: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** A conversation screen with its find field is mounted (`findTarget.ts`). */
  hasFindTarget: boolean;
  /** Open conversation tabs (T8). */
  tabCount: number;
  /**
   * Take ownership of the current place (`src/navigation/ownership.ts`): the
   * owner stays true until the next navigation begins.
   */
  ownPlace: () => PlaceOwner;
  actions: CommandActions;
}

export interface CommandActions {
  openPalette: () => void;
  goBack: () => unknown;
  goForward: () => unknown;
  focusFind: () => void;
  toggleNavigator: () => void;
  toggleMinimap: () => void;
  openSettingsManager: () => unknown;
  openArchive: () => unknown;
  openFeedback: () => void;
  checkForUpdates: () => void;
  newTab: () => unknown;
  closeTab: () => unknown;
  cycleTab: (step: 1 | -1) => unknown;
  /** ⌘1-⌘8 by position; 9 is the last tab. */
  selectTabAt: (position: number) => unknown;
}

interface CommandHandler {
  icon: LucideIcon;
  /** The command exists in this runtime/layout (default: yes). */
  available?: (ctx: CommandContext) => boolean;
  /** The command can run at this place right now (default: yes). */
  enabled?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => unknown;
  /**
   * Where its shortcut still fires. By default a shortcut is left alone while
   * focus is in a text field or a modal dialog.
   */
  keys?: { inFields?: boolean; inDialogs?: boolean };
}

/** The archive belongs to Claude Code; another provider's project disables it. */
const isClaudeContext = (place: Place): boolean => (place.project?.provider ?? "claude") === "claude";

/**
 * Tab shortcuts work from a text field too (the sidebar filter, the find
 * field), as they do in a browser; behind a modal dialog they do not.
 */
const TAB_KEYS = { inFields: true } as const;

/** ⌘n: tab n exists. */
const goToTab = (position: number): CommandHandler => ({
  icon: SquareArrowRight,
  enabled: (ctx) => ctx.tabCount >= (position === 9 ? 1 : position),
  run: (ctx) => ctx.actions.selectTabAt(position),
  keys: TAB_KEYS,
});

/**
 * One handler per manifest id. Typed as a total record, so a manifest
 * command without a handler does not compile.
 */
const HANDLERS: Record<CommandId, CommandHandler> = {
  "palette.open": {
    icon: Search,
    run: (ctx) => ctx.actions.openPalette(),
    keys: { inFields: true, inDialogs: true },
  },
  "go.back": {
    icon: ArrowLeft,
    enabled: (ctx) => ctx.canGoBack,
    run: (ctx) => ctx.actions.goBack(),
  },
  "go.forward": {
    icon: ArrowRight,
    enabled: (ctx) => ctx.canGoForward,
    run: (ctx) => ctx.actions.goForward(),
  },
  "edit.find": {
    icon: TextSearch,
    enabled: (ctx) => ctx.place.view === "conversation" && ctx.place.session != null && ctx.hasFindTarget,
    run: (ctx) => ctx.actions.focusFind(),
    // ⌘F from the sidebar filter (or the find field itself) still means
    // "find in this conversation"; behind a dialog it does not.
    keys: { inFields: true },
  },
  "view.toggleNavigator": {
    icon: SCREEN_ICONS.inspector,
    enabled: (ctx) => !ctx.isMobile,
    run: (ctx) => ctx.actions.toggleNavigator(),
    keys: { inFields: true, inDialogs: true },
  },
  "view.toggleMinimap": {
    icon: MinimapGlyph,
    run: (ctx) => ctx.actions.toggleMinimap(),
    keys: { inDialogs: true },
  },
  "go.settingsManager": {
    icon: SCREEN_ICONS.settings,
    enabled: (ctx) => ctx.place.view !== "settingsManager",
    run: (ctx) => ctx.actions.openSettingsManager(),
  },
  "go.archive": {
    icon: SCREEN_ICONS.archive,
    enabled: (ctx) => ctx.place.view !== "archive" && isClaudeContext(ctx.place),
    run: (ctx) => ctx.actions.openArchive(),
  },
  "help.feedback": {
    icon: MessageSquare,
    run: (ctx) => ctx.actions.openFeedback(),
  },
  "app.checkForUpdates": {
    icon: RefreshCw,
    available: (ctx) => ctx.runtime === "desktop",
    run: (ctx) => ctx.actions.checkForUpdates(),
  },
  "tab.new": {
    icon: Plus,
    run: (ctx) => ctx.actions.newTab(),
    keys: TAB_KEYS,
  },
  "tab.close": {
    icon: X,
    run: (ctx) => ctx.actions.closeTab(),
    keys: TAB_KEYS,
  },
  "tab.next": {
    icon: ChevronRight,
    enabled: (ctx) => ctx.tabCount > 1,
    run: (ctx) => ctx.actions.cycleTab(1),
    keys: TAB_KEYS,
  },
  "tab.previous": {
    icon: ChevronLeft,
    enabled: (ctx) => ctx.tabCount > 1,
    run: (ctx) => ctx.actions.cycleTab(-1),
    keys: TAB_KEYS,
  },
  "tab.goTo1": goToTab(1),
  "tab.goTo2": goToTab(2),
  "tab.goTo3": goToTab(3),
  "tab.goTo4": goToTab(4),
  "tab.goTo5": goToTab(5),
  "tab.goTo6": goToTab(6),
  "tab.goTo7": goToTab(7),
  "tab.goTo8": goToTab(8),
  "tab.goToLast": goToTab(9),
};

export type AppCommand = CommandManifestEntry & CommandHandler;

export const COMMANDS: readonly AppCommand[] = COMMAND_MANIFEST.map((entry) => ({
  ...entry,
  ...HANDLERS[entry.id],
}));

const BY_ID: ReadonlyMap<string, AppCommand> = new Map(COMMANDS.map((command) => [command.id, command]));

export const getCommand = (id: string): AppCommand | undefined => BY_ID.get(id);

export const isCommandAvailable = (command: AppCommand, ctx: CommandContext): boolean =>
  command.available?.(ctx) ?? true;

export const isCommandEnabled = (command: AppCommand, ctx: CommandContext): boolean =>
  isCommandAvailable(command, ctx) && (command.enabled?.(ctx) ?? true);

/**
 * Run a command by id. An unknown, unavailable or disabled command is
 * refused (false) and nothing runs.
 *
 * A command that fails asynchronously is reported with a toast naming it -
 * unless another navigation has begun since, which owns the screen now
 * (`src/navigation/ownership.ts`). `navigate` advances the epoch before its
 * first await, so ownership taken right after `run` returns is the command's
 * own navigation's.
 */
export function runCommand(id: string, ctx: CommandContext): boolean {
  const command = getCommand(id);
  if (!command || !isCommandEnabled(command, ctx)) return false;
  const result = command.run(ctx);
  const ownsFeedback = ctx.ownPlace();
  Promise.resolve(result).catch((error: unknown) => {
    console.error(`Command ${id} failed:`, error);
    if (!ownsFeedback()) return;
    toast.error(i18n.t("common.command.failed", { command: i18n.t(command.labelKey) }));
  });
  return true;
}

/** Commands the ⌘K palette lists in this context (enabled or not). */
export const paletteCommands = (ctx: CommandContext): AppCommand[] =>
  COMMANDS.filter((command) => command.palette !== false && isCommandAvailable(command, ctx));
