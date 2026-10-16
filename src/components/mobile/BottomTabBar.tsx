import { FolderOpen } from "lucide-react";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { Icon as AppIcon } from "@/components/icon/Icon";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MobileTab } from "@/navigation/place";

interface BottomTabBarProps {
  /** The selected tab, projected from the current place (`activeMobileTab`). */
  activeTab: MobileTab | null;
  onOpenSidebar: () => void;
  onSwitchView: (view: string) => void;
  hasProject: boolean;
}

const tabs = [
  { id: "projects", icon: FolderOpen, labelKey: "common.mobile.tab.projects", alwaysEnabled: true },
  { id: "messages", icon: SCREEN_ICONS.conversation, labelKey: "common.mobile.tab.messages", alwaysEnabled: true },
  { id: "board", icon: SCREEN_ICONS.board, labelKey: "common.mobile.tab.board", alwaysEnabled: false },
  { id: "analytics", icon: SCREEN_ICONS.analytics, labelKey: "common.mobile.tab.analytics", alwaysEnabled: false },
  { id: "settings", icon: SCREEN_ICONS.settings, labelKey: "common.mobile.tab.settings", alwaysEnabled: true },
] as const;

export function BottomTabBar({ activeTab, onOpenSidebar, onSwitchView, hasProject }: BottomTabBarProps) {
  const { t } = useTranslation();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 md:hidden h-14 bg-sidebar border-t border-border/50 pb-[env(safe-area-inset-bottom)]"
      aria-label="Navigation"
    >
      <div className="flex items-center justify-around h-full px-2">
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
                "relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                "min-w-0 min-h-[var(--mobile-touch-target)]",
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
              <span className="text-caption font-medium truncate max-w-full">{t(labelKey)}</span>
              {isDisabled && (
                <span className="text-caption text-muted-foreground/60 truncate max-w-full">
                  ({t("common.mobile.selectProject")})
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
