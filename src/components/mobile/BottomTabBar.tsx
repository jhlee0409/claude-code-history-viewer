import { FolderOpen } from "lucide-react";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { Icon as AppIcon } from "@/components/icon/Icon";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MobileTab } from "@/navigation/place";
import { placeNameKey } from "@/navigation/placeNames";
import { wordBreakRuns } from "./tabLabelBreaks";

interface BottomTabBarProps {
  /** The selected tab, projected from the current place (`activeMobileTab`). */
  activeTab: MobileTab | null;
  onOpenSidebar: () => void;
  onSwitchView: (view: string) => void;
  hasProject: boolean;
}

const tabs = [
  { id: "projects", icon: FolderOpen, labelKey: "common.mobile.tab.projects", alwaysEnabled: true },
  { id: "messages", icon: SCREEN_ICONS.conversation, labelKey: placeNameKey("conversation"), alwaysEnabled: true },
  { id: "board", icon: SCREEN_ICONS.board, labelKey: placeNameKey("board"), alwaysEnabled: false },
  { id: "analytics", icon: SCREEN_ICONS.analytics, labelKey: placeNameKey("analytics"), alwaysEnabled: false },
  { id: "settings", icon: SCREEN_ICONS.settings, labelKey: placeNameKey("settingsManager"), alwaysEnabled: true },
] as const;

export function BottomTabBar({ activeTab, onOpenSidebar, onSwitchView, hasProject }: BottomTabBarProps) {
  const { t, i18n } = useTranslation();

  return (
    <nav
      data-mobile-tab-bar=""
      className="fixed bottom-0 inset-x-0 z-40 md:hidden h-[var(--mobile-bottom-inset)] bg-sidebar border-t border-border/50 pb-[env(safe-area-inset-bottom)]"
      aria-label={t("common.a11y.navigation")}
    >
      <div className="flex items-center justify-around h-full px-1">
        {tabs.map(({ id, icon: Icon, labelKey, alwaysEnabled }) => {
          const isActive = id !== "projects" && id === activeTab;
          const isDisabled = !alwaysEnabled && !hasProject;

          const handlePress = () => {
            if (isDisabled) return;
            if (id === "projects") {
              onOpenSidebar();
            } else {
              onSwitchView(id);
            }
          };

          return (
            <button
              key={id}
              onClick={handlePress}
              disabled={isDisabled}
              className={cn(
                // Equal widths, except that no tab is narrower than its
                // longest word (`min-w-min`): a label wraps between words,
                // never inside one. Icon + two label lines (24 + 2 + 2 × 15)
                // sit inside the 64 px bar with room above and below.
                "relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                "min-w-min min-h-[var(--mobile-touch-target)]",
                isActive
                  ? "text-accent"
                  : "text-muted-foreground",
                isDisabled && "opacity-40 cursor-not-allowed"
              )}
              aria-label={t(labelKey)}
              aria-current={isActive ? "page" : undefined}
            >
              {/* Mobile tab bar: 24 px, the platform convention for bottom tabs. */}
              <AppIcon icon={Icon} size={24} aria-hidden="true" />
              {/*
                Every tab shows its place's one name, however long ("Claude
                Code Settings"): the label wraps to two tight lines at the
                caption size (12 px) instead of being cut or renamed, and
                breaks only between words (`break-keep`: "プロジェクト" stays
                whole; "Claude Code 設定" breaks at its spaces, "セッションボード"
                at the <wbr> between its words).
              */}
              <span
                data-tab-label=""
                className="max-w-full text-center text-caption font-medium leading-tight line-clamp-2 break-keep"
              >
                {wordBreakRuns(t(labelKey), i18n.language).map((run, i) => (
                  <Fragment key={i}>
                    {i > 0 && <wbr />}
                    {run}
                  </Fragment>
                ))}
              </span>
              {isDisabled && (
                <span className="text-caption text-muted-foreground/60 truncate max-w-full">
                  ({t("common.mobile.selectProject")})
                </span>
              )}
              {isActive && (
                // The current-tab marker sits on the bar's top edge: under a
                // two-line label there is no free space below.
                <span data-tab-indicator="" className="absolute top-0 h-0.5 w-5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
