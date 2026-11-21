import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/store/useAppStore";
import { useTranslation } from "react-i18next";
import { Coins, FolderSync, Map as MapIcon } from "lucide-react";
import { DesktopOnly } from "@/contexts/platform";
import { isLiveRefreshOn } from "@/types";
import { getMinimapToggleKeysLabel } from "@/utils/minimapShortcut";

/**
 * Design §7 / Decision 1: a new "View" heading, since the switch toggles a
 * display, not a message filter, and the settings menu has no existing
 * display heading to reuse. Copies "Show system messages" in
 * `FilterMenuGroup.tsx` exactly (role, aria-checked, decorative Switch).
 */
export const ViewMenuGroup = () => {
  const { t } = useTranslation();
  const {
    isMinimapOpen,
    toggleMinimap,
    showInlineTokenUsage,
    toggleInlineTokenUsage,
    userMetadata,
    toggleLiveRefresh,
  } = useAppStore();
  const liveRefresh = isLiveRefreshOn(userMetadata);
  const keys = getMinimapToggleKeysLabel();

  return (
    <>
      <DropdownMenuLabel>
        {t("common.settings.view.title")}
      </DropdownMenuLabel>
      <DropdownMenuItem
        role="menuitemcheckbox"
        aria-checked={isMinimapOpen}
        title={t("common.settings.view.minimapShortcutHint", { keys })}
        onSelect={(e) => {
          e.preventDefault();
          toggleMinimap();
        }}
      >
        <MapIcon className="mr-2 h-4 w-4 text-foreground" />
        <span className="flex-1">
          {t("common.settings.view.showMinimap")}
        </span>
        <DropdownMenuShortcut aria-hidden="true">{keys}</DropdownMenuShortcut>
        <Switch
          checked={isMinimapOpen}
          aria-hidden="true"
          tabIndex={-1}
          className="ml-2"
        />
      </DropdownMenuItem>
      <DropdownMenuItem
        role="menuitemcheckbox"
        aria-checked={showInlineTokenUsage}
        onSelect={(e) => {
          e.preventDefault();
          toggleInlineTokenUsage();
        }}
      >
        <Coins className="mr-2 h-4 w-4 text-foreground" />
        <span className="flex-1">
          {t("common.settings.view.showInlineTokens")}
        </span>
        <Switch
          checked={showInlineTokenUsage}
          aria-hidden="true"
          tabIndex={-1}
          className="ml-2"
        />
      </DropdownMenuItem>
      {/* The desktop app's history-folder watcher (#820). */}
      <DesktopOnly>
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={liveRefresh}
          title={t("common.settings.view.liveRefreshHint")}
          onSelect={(e) => {
            e.preventDefault();
            void toggleLiveRefresh();
          }}
        >
          <FolderSync className="mr-2 h-4 w-4 text-foreground" />
          <span className="flex-1">
            {t("common.settings.view.liveRefresh")}
          </span>
          <Switch
            checked={liveRefresh}
            aria-hidden="true"
            tabIndex={-1}
            className="ml-2"
          />
        </DropdownMenuItem>
      </DesktopOnly>
    </>
  );
};
