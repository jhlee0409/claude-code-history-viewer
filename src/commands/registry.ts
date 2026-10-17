/**
 * The command registry (plan §4.4): the manifest plus what only the frontend
 * knows - the icon, whether the command applies here, whether it can run
 * now, and how it runs.
 *
 * Every route to a command - a DOM shortcut (`shortcuts.ts`), the ⌘K palette,
 * a toolbar control and the desktop's native menu (`nativeMenu.ts`) - goes
 * through `runCommand`, so they share one `enabled` check, and through the
 * one command queue (`commandQueue.ts`, via `dispatchCommand`), so they run
 * in the order they arrived. A command runs through the app's own actions
 * (`navigate` via the screen switches, the store's toggles, the modal
 * context); the registry holds no state of its own.
 *
 * Every handler declares what it acts on (`target`, `commandTarget.ts`): a
 * command acts on the tab the user saw in front when they issued it, even if
 * it runs later, or does nothing (docs/adr/0001-native-menu-input-ownership.md,
 * decision 6).
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
  Scan,
  Search,
  SlidersHorizontal,
  SquareArrowRight,
  TextSearch,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { isInspectorAvailable } from "@/components/Inspector/inspectorAvailability";
import i18n from "i18next";
import type { PlaceOwner } from "@/navigation/ownership";
import type { Place } from "@/navigation/place";
import type { KeyEnvironment, Runtime } from "./keys";
import { COMMAND_MANIFEST, type CommandId, type CommandManifestEntry } from "./manifest";
import { engineOwnsZoomInput, type ZoomStep } from "./zoom";
import { appCommandQueue, type CommandQueue } from "./commandQueue";
import { idAtPosition } from "@/navigation/documents";
import { APP_TARGET, menuIssuedTabs, targetTab, type CommandTarget, type TabsSnapshot } from "./commandTarget";

/** What a command needs to know and do. Built per use by `useCommandContext`. */
export interface CommandContext {
  place: Place;
  runtime: Runtime;
  isMobile: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** A conversation screen with its find field is mounted (`findTarget.ts`). */
  hasFindTarget: boolean;
  /** The open conversation tabs (T8): the one in front, and their order. */
  tabs: TabsSnapshot;
  /**
   * Take ownership of the current place (`src/navigation/ownership.ts`): the
   * owner stays true until the next navigation begins.
   */
  ownPlace: () => PlaceOwner;
  actions: CommandActions;
}

export interface CommandActions {
  openPalette: () => void;
  /** Open the app's preferences: the toolbar's gear menu. */
  openPreferences: () => void;
  goBack: () => unknown;
  goForward: () => unknown;
  focusFind: () => void;
  toggleInspector: () => void;
  toggleMinimap: () => void;
  openSettingsManager: () => unknown;
  openArchive: () => unknown;
  openFeedback: () => void;
  checkForUpdates: () => void;
  newTab: () => unknown;
  /** Close tab `id` (in front or not). */
  closeTab: (id: string) => unknown;
  /** The tab after / before `from`, wrapping around. */
  cycleTab: (from: string, step: 1 | -1) => unknown;
  /** Bring tab `id` to the front. */
  selectTab: (id: string) => unknown;
  /** Zoom the web view (`zoom.ts`). */
  zoom: (step: ZoomStep) => unknown;
}

interface CommandHandler {
  icon: LucideIcon;
  /** The command exists in this runtime/layout (default: yes). */
  available?: (ctx: CommandContext) => boolean;
  /** The command can run at this place right now (default: yes). */
  enabled?: (ctx: CommandContext) => boolean;
  /**
   * What it acts on, captured when it is issued (`commandTarget.ts`). Every
   * handler says so, and acts on the `tab` it is handed - never on the tab in
   * front when it runs, which may have been chosen after it was issued
   * (review-4 F1, review-5).
   */
  target: CommandTarget;
  /** `tab`: the tab its target names (for an `app` command, the one in front). */
  run: (ctx: CommandContext, tab: string) => unknown;
  /**
   * Where its shortcut still fires. By default a shortcut is left alone while
   * focus is in a text field or a modal dialog. `byEngine`: where the web
   * view itself handles the keys, so the shortcut listener does not bind them.
   */
  keys?: { inFields?: boolean; inDialogs?: boolean; byEngine?: (env: KeyEnvironment) => boolean };
}

/** The archive belongs to Claude Code; another provider's project disables it. */
const isClaudeContext = (place: Place): boolean => (place.project?.provider ?? "claude") === "claude";

/**
 * Tab shortcuts work from a text field too (the sidebar filter, the find
 * field), as they do in a browser; behind a modal dialog they do not. Only
 * their ⌘ / Ctrl chords do: the WebUI's ⌥ chords type characters in a field
 * on macOS, so the shortcut listener leaves them to it (`shortcuts.ts`).
 */
const TAB_KEYS = { inFields: true } as const;

/**
 * Zoom is the desktop web view's (`zoom.ts`): in the WebUI the browser's own
 * zoom keeps ⌘= ⌘- ⌘0. It works from a text field and a dialog, as browser
 * zoom does. On Windows WebView2 runs the zoom keys itself (with its pinch
 * zoom); the menu items there set the same engine zoom.
 */
const zoomCommand = (icon: LucideIcon, step: ZoomStep): CommandHandler => ({
  icon,
  target: APP_TARGET,
  available: (ctx) => ctx.runtime === "desktop",
  run: (ctx) => ctx.actions.zoom(step),
  keys: { inFields: true, inDialogs: true, byEngine: engineOwnsZoomInput },
});

/** The tab in front at issue: what its back/forward, find and screens belong to. */
const SHOWN: CommandTarget = { scope: "shown" };

/** ⌘n: tab n exists. It names the tab at that position when it was pressed. */
const goToTab = (position: number): CommandHandler => ({
  icon: SquareArrowRight,
  enabled: (ctx) => ctx.tabs.ids.length >= (position === 9 ? 1 : position),
  target: { scope: "shown", pick: (tabs) => idAtPosition(tabs.ids, position) },
  run: (ctx, tab) => ctx.actions.selectTab(tab),
  keys: TAB_KEYS,
});

/**
 * One handler per manifest id. Typed as a total record, so a manifest
 * command without a handler does not compile.
 */
const HANDLERS: Record<CommandId, CommandHandler> = {
  "palette.open": {
    icon: Search,
    target: APP_TARGET,
    run: (ctx) => ctx.actions.openPalette(),
    keys: { inFields: true, inDialogs: true },
  },
  "go.back": {
    icon: ArrowLeft,
    enabled: (ctx) => ctx.canGoBack,
    target: SHOWN,
    run: (ctx) => ctx.actions.goBack(),
  },
  "go.forward": {
    icon: ArrowRight,
    enabled: (ctx) => ctx.canGoForward,
    target: SHOWN,
    run: (ctx) => ctx.actions.goForward(),
  },
  "edit.find": {
    icon: TextSearch,
    enabled: (ctx) => ctx.place.view === "conversation" && ctx.place.session != null && ctx.hasFindTarget,
    target: SHOWN,
    run: (ctx) => ctx.actions.focusFind(),
    // ⌘F from the sidebar filter (or the find field itself) still means
    // "find in this conversation"; behind a dialog it does not.
    keys: { inFields: true },
  },
  "view.toggleInspector": {
    icon: SCREEN_ICONS.inspector,
    // Only where the panel can show: elsewhere a toggle would flip the saved
    // open state unseen, and the panel would pop open later.
    enabled: (ctx) =>
      isInspectorAvailable({ isMobile: ctx.isMobile, view: ctx.place.view, hasSession: ctx.place.session != null }),
    // Its open state is app-wide (`stateScope.ts`), not the tab's.
    target: APP_TARGET,
    run: (ctx) => ctx.actions.toggleInspector(),
    keys: { inFields: true, inDialogs: true },
  },
  "view.toggleMinimap": {
    icon: MinimapGlyph,
    target: APP_TARGET,
    run: (ctx) => ctx.actions.toggleMinimap(),
    keys: { inDialogs: true },
  },
  "view.zoomIn": zoomCommand(ZoomIn, "in"),
  "view.zoomOut": zoomCommand(ZoomOut, "out"),
  "view.actualSize": zoomCommand(Scan, "reset"),
  "go.settingsManager": {
    icon: SCREEN_ICONS.settings,
    enabled: (ctx) => ctx.place.view !== "settingsManager",
    target: SHOWN,
    run: (ctx) => ctx.actions.openSettingsManager(),
  },
  "go.archive": {
    icon: SCREEN_ICONS.archive,
    enabled: (ctx) => ctx.place.view !== "archive" && isClaudeContext(ctx.place),
    target: SHOWN,
    run: (ctx) => ctx.actions.openArchive(),
  },
  "help.feedback": {
    icon: MessageSquare,
    target: APP_TARGET,
    run: (ctx) => ctx.actions.openFeedback(),
  },
  "app.checkForUpdates": {
    icon: RefreshCw,
    target: APP_TARGET,
    available: (ctx) => ctx.runtime === "desktop",
    run: (ctx) => ctx.actions.checkForUpdates(),
  },
  "tab.new": {
    icon: Plus,
    // Opens at the end, whatever is in front.
    target: APP_TARGET,
    run: (ctx) => ctx.actions.newTab(),
    keys: TAB_KEYS,
  },
  "tab.close": {
    icon: X,
    // The tab in front at issue, closed even if another came in front since.
    target: { scope: "tab" },
    run: (ctx, tab) => ctx.actions.closeTab(tab),
    keys: TAB_KEYS,
  },
  "tab.next": {
    icon: ChevronRight,
    enabled: (ctx) => ctx.tabs.ids.length > 1,
    target: SHOWN,
    run: (ctx, tab) => ctx.actions.cycleTab(tab, 1),
    keys: TAB_KEYS,
  },
  "tab.previous": {
    icon: ChevronLeft,
    enabled: (ctx) => ctx.tabs.ids.length > 1,
    target: SHOWN,
    run: (ctx, tab) => ctx.actions.cycleTab(tab, -1),
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
  "app.preferences": {
    icon: SlidersHorizontal,
    target: APP_TARGET,
    run: (ctx) => ctx.actions.openPreferences(),
  },
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
 * refused (false) and nothing runs; so is one whose target is gone: the tab
 * it was issued on is closed, or (`shown`) no longer in front. `issued`: the
 * tabs when it was issued (default: now - it runs as it is issued); null
 * when that is unknown, so only an `app` command runs.
 *
 * A command that fails asynchronously is reported with a toast naming it -
 * unless another navigation has begun since, which owns the screen now
 * (`src/navigation/ownership.ts`). `navigate` advances the epoch before its
 * first await, so ownership taken right after `run` returns is the command's
 * own navigation's.
 */
export function runCommand(id: string, ctx: CommandContext, issued: TabsSnapshot | null = ctx.tabs): boolean {
  const command = getCommand(id);
  if (!command || !isCommandEnabled(command, ctx)) return false;
  const tab = targetTab(command.target, issued, ctx.tabs);
  if (tab === null) return false;
  const result = command.run(ctx, tab);
  const ownsFeedback = ctx.ownPlace();
  Promise.resolve(result).catch((error: unknown) => {
    console.error(`Command ${id} failed:`, error);
    if (!ownsFeedback()) return;
    toast.error(i18n.t("common.command.failed", { command: i18n.t(command.labelKey) }));
  });
  return true;
}

/**
 * Issue a command from a key, the palette or a control, now: the tabs it
 * acts on are the ones the user sees now (`commandTarget.ts`), whatever
 * runs before it. Returns the job to hand to the queue (`submit`, or a
 * hold's `run`); it checks `enabled` with the context of the moment it runs.
 */
export function issueCommand(id: string, getContext: () => CommandContext): () => void {
  const issued = getContext().tabs;
  return () => {
    runCommand(id, getContext(), issued);
  };
}

/**
 * Issue a menu event's command: its target is the tab the host stamped as
 * in front when the user chose it (`menuIssuedTabs`) - not the tab in front
 * when the page hears of it. No stamp: only an `app` command runs.
 */
export function issueMenuCommand(
  id: string,
  frontTabId: string | null | undefined,
  getContext: () => CommandContext,
): () => void {
  return () => {
    const ctx = getContext();
    runCommand(id, ctx, menuIssuedTabs(frontTabId, ctx.tabs));
  };
}

/**
 * Run a command from an input (a key, the palette, a control) through the
 * one command queue (`commandQueue.ts`): at once in the steady state, or
 * after the commands ahead of it - menu events the journal is still fetching.
 *
 * Returns whether the command can run now; an unknown, unavailable or
 * disabled one is refused and nothing is queued. It then runs through
 * `runCommand` with the context of the moment it runs, which checks
 * `enabled` again (a command ahead of it may have changed the state), on
 * the target it was issued against (`issueCommand`).
 */
export function dispatchCommand(
  id: string,
  getContext: () => CommandContext,
  queue: CommandQueue = appCommandQueue,
): boolean {
  const command = getCommand(id);
  if (!command || !isCommandEnabled(command, getContext())) return false;
  queue.submit(issueCommand(id, getContext));
  return true;
}

/** Commands the ⌘K palette lists in this context (enabled or not). */
export const paletteCommands = (ctx: CommandContext): AppCommand[] =>
  COMMANDS.filter((command) => command.palette !== false && isCommandAvailable(command, ctx));
