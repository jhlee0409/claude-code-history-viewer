import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useState } from "react";

import { TooltipButton } from "@/shared/TooltipButton";
import { useAppStore } from "@/store/useAppStore";
import { selectPlace } from "@/store/slices/navigationSlice";
import { activeLibraryItem, activeToolbarView, isAppView, type ToolbarView } from "@/navigation/place";
import { VIEW_PANEL_ID, viewTabId } from "./viewTabIds";
import { TOOLBAR_TAB_ORDER, VIEW_REGISTRY } from "@/layouts/shell/viewRegistry";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import { useCommandRunner } from "@/commands/CommandRunner";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";

import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isActionModifier, isMacOS, isTauri } from "@/utils/platform";
import { openInNewTab } from "@/navigation/tabs";
import { MobileTabsButton } from "@/layouts/shell/MobileTabsButton";
import { SettingDropdown } from "./SettingDropdown";
import { getProjectDisplayName } from "@/utils/pathUtils";
import { SessionCopyMenu } from "./SessionCopyMenu";
import { INSPECTOR_TOGGLE_ID } from "@/components/Inspector/inspectorFocus";

interface HeaderProps {
  analyticsActions: UseAnalyticsReturn["actions"];
  analyticsComputed: UseAnalyticsReturn["computed"];
  updater: UseUpdaterReturn;
}

const SHORTCUT_LABEL = isMacOS() ? "⌘K" : "Ctrl+K";

// macOS traffic-light buttons overlap the header in Tauri's Overlay
// titleBarStyle. Reserve space for them only when running in the desktop
// shell — the WebUI build has no overlay controls.
const HAS_MACOS_TRAFFIC_LIGHTS = isTauri() && isMacOS();

const InspectorIcon = SCREEN_ICONS.inspector;

/**
 * The toolbar (plan T7, decision page §1):
 *
 *   ‹ ›  location path  │  Conversation · Analytics · Edits · Board  │  ⌘K  ⟳  ▯  ⚙
 *
 * - back / forward walk the document history (T2) through the `go.back` /
 *   `go.forward` commands, the same ones ⌘[ / ⌘] run;
 * - the location path names where the main area is;
 * - the screen tabs come from the view registry and switch the screen of the
 *   current place (the selected tab is a projection of the place, plan C3);
 * - the palette and inspector buttons run `palette.open` and
 *   `view.toggleInspector`;
 * - the gear menu holds preferences only (D8); the Claude Code tools moved to
 *   the sidebar library, the palette and (T11a) the menu bar.
 */
export const Header = ({ analyticsActions, analyticsComputed, updater }: HeaderProps) => {
  const { t } = useTranslation();
  const commands = useCommandRunner();

  const {
    selectedProject,
    selectedSession,
    isLoadingProjects,
    isLoadingSessions,
    isLoadingMessages,
    isRefreshingAllConversations,
    refreshAllConversations,
    recentEditsMode,
    toggleRecentEditsDock,
    setRecentEditsDockOpen,
  } = useAppStore();
  const canGoBack = useAppStore((s) => s.placeHistory.back.length > 0);
  const canGoForward = useAppStore((s) => s.placeHistory.forward.length > 0);
  const isInspectorOpen = useAppStore((s) => s.isInspectorOpen);
  const view = useAppStore((s) => s.view);

  const computed = analyticsComputed;
  // The selected tab is a projection of the place, so global stats, the
  // archive and the Settings Manager (no tab of their own) select none.
  const activeTab = useAppStore((s) => activeToolbarView(selectPlace(s)));
  const libraryItem = useAppStore((s) => activeLibraryItem(selectPlace(s)));
  const isClaudeProject = (selectedProject?.provider ?? "claude") === "claude";
  const hasProject = selectedProject != null;
  // One tab stop for the whole tablist (roving tabindex): the selected tab,
  // or the first enabled one while an app screen selects none.
  const tabDisabled: Record<ToolbarView, boolean> = {
    conversation: !hasProject,
    analytics: !hasProject || computed.isLoadingAnalytics,
    edits: !hasProject || computed.isLoadingRecentEdits,
    board: !hasProject || !isClaudeProject,
  };
  // The stop roves with focus (APG): the tab the user last focused keeps it,
  // as long as it stays enabled and the place has not moved since. Keyed to
  // the selection it was taken under, so a new place resets it without an
  // effect: the stop goes back to the newly selected tab.
  const [roving, setRoving] = useState<{
    under: ToolbarView | null;
    view: ToolbarView;
  } | null>(null);
  const rovingStop =
    roving && roving.under === activeTab && !tabDisabled[roving.view]
      ? roving.view
      : undefined;
  const tabStop: ToolbarView | undefined =
    rovingStop ??
    (activeTab && !tabDisabled[activeTab]
      ? activeTab
      : TOOLBAR_TAB_ORDER.find((tabView) => !tabDisabled[tabView]));
  const roveTo = (tabView: ToolbarView) => setRoving({ under: activeTab, view: tabView });
  const isRefreshingConversations =
    isRefreshingAllConversations ||
    isLoadingProjects ||
    isLoadingSessions ||
    isLoadingMessages;

  const handleLoadAnalytics = async () => {
    if (!selectedProject) return;
    try {
      await analyticsActions.switchToAnalytics();
    } catch (error) {
      console.error("Failed to load analytics:", error);
    }
  };

  const handleLoadRecentEdits = async () => {
    if (!selectedProject) return;

    // The button routes on mode. In "docked" mode it toggles the side panel
    // beside the transcript; in "page" mode it keeps today's behaviour of
    // taking over the content area.
    // The dock is CSS-gated at the `xl` breakpoint, so a docked-mode preference
    // carried over from a wide window (or restored on a narrow one) would
    // otherwise toggle state that nothing can render. Read the width at click
    // time rather than holding reactive state for it.
    const dockCanRender =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches;

    if (recentEditsMode === "docked" && selectedSession && dockCanRender) {
      // The dock only renders inside the transcript branch of the layout, so
      // from any other view (Analytics, Board, Settings) a plain toggle just
      // flips invisible state and looks like a dead button. Go to the
      // transcript and open the dock instead of toggling it shut.
      if (!analyticsComputed.isMessagesView) {
        setRecentEditsDockOpen(true);
        analyticsActions.switchToMessages();
        return;
      }
      toggleRecentEditsDock();
      return;
    }

    try {
      await analyticsActions.switchToRecentEdits();
    } catch (error) {
      console.error("Failed to load recent edits:", error);
    }
  };

  const handleLoadBoard = async () => {
    if (!selectedProject) return;
    try {
      await analyticsActions.switchToBoard();
    } catch (error) {
      console.error("Failed to load board:", error);
      window.alert(t("session.board.error.loadBoard"));
    }
  };

  // What each view tab does; its icon and label come from the view registry.
  const tabBehaviour: Record<ToolbarView, TabBehaviour> = {
    conversation: {
      onClick: () => {
        if (!computed.isMessagesView) analyticsActions.switchToMessages();
      },
    },
    analytics: {
      isLoading: computed.isLoadingAnalytics,
      onClick: () => {
        if (!computed.isAnalyticsView) handleLoadAnalytics();
      },
    },
    edits: {
      isLoading: computed.isLoadingRecentEdits,
      onClick: () => {
        if (computed.isRecentEditsView && recentEditsMode !== "docked") {
          analyticsActions.switchToMessages();
        } else {
          handleLoadRecentEdits();
        }
      },
    },
    board: {
      // The board reads Claude Code data only; elsewhere the tab says why it is off.
      label: hasProject && !isClaudeProject
        ? t("common.settings.claudeOnly", { name: t("session.board.title") })
        : undefined,
      onClick: () => {
        if (!computed.isBoardView) handleLoadBoard();
      },
    },
  };

  // Location: library › app screen, or project › session / project screen.
  const location: string[] = (() => {
    if (libraryItem || isAppView(view)) {
      return [t("project.library.title"), t(VIEW_REGISTRY[view].titleKey)];
    }
    if (!selectedProject) return [t("common.appName")];
    const projectName = getProjectDisplayName(selectedProject);
    if (computed.isMessagesView || computed.isEmptyView) {
      return selectedSession
        ? [
            projectName,
            selectedSession.summary || `${t("session.title")} ${selectedSession.session_id.slice(-8)}`,
          ]
        : [projectName];
    }
    return [projectName, t(VIEW_REGISTRY[view].titleKey)];
  })();
  const inspectorLabel = t("common.toolbar.inspector");

  return (
    <header
      id="app-header"
      role="banner"
      className={cn(
        "relative h-11 shrink-0 flex items-center gap-2 px-2 md:px-3 bg-sidebar border-b border-border/50",
        HAS_MACOS_TRAFFIC_LIGHTS && "pl-[76px] md:pl-[76px]"
      )}
    >
      {/* Full-header drag region — sits behind all content so the
          entire header is draggable. Interactive children sit above with
          their own pointer events; the location path uses
          pointer-events-none so drags on it fall through to this layer. */}
      <div data-tauri-drag-region className="absolute inset-0" />

      {/* Left: history + location. flex-1 on both sides keeps the tabs centred. */}
      <div className="relative z-10 flex min-w-0 flex-1 basis-0 items-center gap-1">
        <ToolbarIconButton
          icon={ChevronLeft}
          label={t("common.command.back")}
          disabled={!canGoBack}
          onClick={() => commands.run("go.back")}
        />
        <ToolbarIconButton
          icon={ChevronRight}
          label={t("common.command.forward")}
          disabled={!canGoForward}
          onClick={() => commands.run("go.forward")}
        />
        <h1 className="sr-only">{t("common.appName")}</h1>
        <nav aria-label={t("common.toolbar.location")} className="ml-1 min-w-0 pointer-events-none">
          <ol className="flex min-w-0 items-center gap-1 text-list">
            {location.map((segment, index) => {
              const isLast = index === location.length - 1;
              return (
                // Parent segments give way first, but never to nothing: a
                // segment squeezed to zero left its separator alone, reading
                // as a third history arrow. A phone shows the current place
                // only (its tab bar and drawer carry the rest).
                <li
                  key={`${index}:${segment}`}
                  className={cn("flex min-w-0 items-center gap-1", !isLast && "hidden md:flex shrink-[2]")}
                >
                  {index > 0 && (
                    <ChevronRight className="hidden md:block w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span
                    className={cn(
                      "truncate pointer-events-auto",
                      isLast ? "font-semibold text-foreground" : "min-w-6 text-muted-foreground"
                    )}
                    title={segment}
                    aria-current={isLast ? "location" : undefined}
                  >
                    {segment}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* Centre: the screen tabs (md and up; the mobile bar has its own). */}
      <div
        role="tablist"
        aria-label={t("header.views", "Views")}
        onKeyDown={moveFocusAcrossTabs}
        className="relative z-10 hidden md:flex shrink-0 items-center gap-0.5 bg-muted/60 rounded-lg p-0.5 border border-border/60"
      >
        {TOOLBAR_TAB_ORDER.map((tabView) => {
          const { icon, tab: { labelKey } } = VIEW_REGISTRY[tabView];
          const tab = tabBehaviour[tabView];
          return (
            <ViewTab
              key={tabView}
              icon={tab.isLoading ? LoaderCircle : icon}
              label={tab.label ?? t(labelKey)}
              view={tabView}
              tabStop={tabStop === tabView}
              onFocus={roveTo}
              isActive={activeTab === tabView}
              isLoading={tab.isLoading}
              onClick={(event) => {
                // ⌘+click (Ctrl+click elsewhere): this screen in a new tab
                // (decision page §2).
                if (isActionModifier(event)) {
                  // A failure takes the new tab away again (`openInNewTab`).
                  openInNewTab(() => analyticsActions.openView(tabView)).catch((error: unknown) => {
                    console.error(`Failed to open ${tabView} in a new tab:`, error);
                    toast.error(t("common.tabs.openScreenFailed"));
                  });
                  return;
                }
                tab.onClick();
              }}
              disabled={tabDisabled[tabView]}
            />
          );
        })}
      </div>

      {/* Right: actions. */}
      <div className="relative z-10 flex min-w-0 flex-1 basis-0 items-center justify-end gap-1">
        {selectedSession && computed.isMessagesView && (
          <SessionCopyMenu compact project={selectedProject} session={selectedSession} />
        )}

        <button
          type="button"
          onClick={() => commands.run("palette.open")}
          className="hidden md:inline-flex h-7 shrink-0 items-center gap-1.5 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/50 text-list"
          aria-label={t("common.commandPalette")}
          title={t("common.commandPalette")}
        >
          <Search className="w-4 h-4" />
          <span className="hidden lg:inline">{t("common.toolbar.search")}</span>
          <kbd className="px-1 text-caption font-mono bg-muted rounded border border-border">
            {SHORTCUT_LABEL}
          </kbd>
        </button>
        {/* Phones have no tab strip: the open tabs are a sheet away. */}
        <MobileTabsButton screens={{ openView: analyticsActions.openView }} />
        <ToolbarIconButton
          className="md:hidden"
          icon={Search}
          label={t("common.commandPalette")}
          onClick={() => commands.run("palette.open")}
        />

        {/* Refresh — rescans projects and reloads the selected session. */}
        <ToolbarIconButton
          icon={RefreshCw}
          label={t("session.refreshAllConversations", "Refresh all conversations")}
          disabled={isRefreshingConversations}
          spinning={isRefreshingConversations}
          onClick={() => {
            void refreshAllConversations();
          }}
        />

        <ToolbarIconButton
          className="hidden md:inline-flex"
          icon={InspectorIcon}
          label={inspectorLabel}
          id={INSPECTOR_TOGGLE_ID}
          pressed={isInspectorOpen}
          disabled={!computed.isMessagesView || !selectedSession}
          onClick={() => commands.run("view.toggleInspector")}
        />

        {/* App menu: preferences only (plan D8). */}
        <SettingDropdown updater={updater} />
      </div>
    </header>
  );
};

interface TabBehaviour {
  onClick: () => void;
  isLoading?: boolean;
  /** Replaces the registry label. */
  label?: string;
}

/** A 28px toolbar icon button; its label is the tooltip and the accessible name. */
const ToolbarIconButton = ({
  icon: Glyph,
  label,
  onClick,
  disabled = false,
  pressed,
  spinning = false,
  className,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  spinning?: boolean;
  className?: string;
  id?: string;
}) => (
  <TooltipButton
    id={id}
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={pressed}
    className={cn(
      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
      "text-muted-foreground hover:text-foreground hover:bg-muted",
      pressed && "bg-muted text-foreground",
      disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
      className
    )}
    content={label}
  >
    <Glyph className={cn("w-4 h-4", pressed && "text-accent", spinning && "animate-spin")} />
  </TooltipButton>
);

/**
 * Arrow keys / Home / End move focus between the enabled tabs (APG tabs,
 * manual activation: Enter or Space opens the focused one).
 */
function moveFocusAcrossTabs(event: React.KeyboardEvent<HTMLElement>) {
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')
  );
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  if (current === -1 || tabs.length === 0) return;
  const next = focusTarget(event.key, current, tabs.length);
  if (next === null) return;
  event.preventDefault();
  tabs[next]?.focus();
}

/** The tab index a navigation key moves focus to, or null for other keys. */
function focusTarget(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/* Segmented view tab: icon always, label from lg up. */
interface ViewTabProps {
  view: ToolbarView;
  /** The tablist's single Tab stop (roving tabindex). */
  tabStop: boolean;
  /** Focus landed on this tab: it becomes the roving Tab stop. */
  onFocus: (view: ToolbarView) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  isLoading?: boolean;
  onClick: (event: React.MouseEvent) => void;
  disabled?: boolean;
}

const ViewTab = ({
  view,
  tabStop,
  onFocus,
  icon: Icon,
  label,
  isActive,
  isLoading,
  onClick,
  disabled,
}: ViewTabProps) => {
  return (
    <TooltipButton
      role="tab"
      id={viewTabId(view)}
      aria-selected={isActive ?? false}
      aria-controls={VIEW_PANEL_ID}
      tabIndex={tabStop ? 0 : -1}
      onFocus={() => onFocus(view)}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 items-center gap-1.5 px-2 rounded-md text-list transition-colors whitespace-nowrap",
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      content={label}
    >
      {/* Selected: the icon takes the accent (#9AA0F0 in dark, decision page 7). */}
      <Icon className={cn("w-4 h-4", isActive && !isLoading && "text-accent", isLoading && "animate-spin")} />
      <span className="hidden lg:inline">{label}</span>
    </TooltipButton>
  );
};
