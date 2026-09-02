import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Settings, RefreshCw, MessageSquare, Folder, Loader2, Archive, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import { useTranslation } from "react-i18next";
import { useModal } from "@/contexts/modal";
import { DesktopOnly } from "@/contexts/platform";
import { ThemeMenuGroup } from "./ThemeMenuGroup";
import { LanguageMenuGroup } from "./LanguageMenuGroup";
import { FilterMenuGroup } from "./FilterMenuGroup";
import { FontMenuGroup } from "./FontMenuGroup";
import { AccessibilityMenuGroup } from "./AccessibilityMenuGroup";

interface SettingDropdownProps {
  updater: UseUpdaterReturn;
  /** Claude-only tool; disabled for other providers. */
  onOpenArchive?: () => void;
  archiveDisabled?: boolean;
  onOpenSettingsManager?: () => void;
}

export const SettingDropdown = ({
  updater,
  onOpenArchive,
  archiveDisabled = false,
  onOpenSettingsManager,
}: SettingDropdownProps) => {
  const { t } = useTranslation();
  const { openModal } = useModal();

  const isCheckingForUpdates = updater.state.isChecking;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            id="app-settings-button"
            className="p-2 rounded-lg transition-colors cursor-pointer relative text-muted-foreground/50 hover:text-foreground/80 hover:bg-muted"
            aria-label={t("common.settings.title")}
          >
            <Settings className="w-5 h-5 text-foreground" />
            {isCheckingForUpdates && (
              <Loader2 className="absolute -top-1 -right-1 w-3 h-3 animate-spin text-info" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {(onOpenSettingsManager || onOpenArchive) && (
            <>
              <DropdownMenuLabel>{t("common.settings.tools", "Claude Code")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {onOpenSettingsManager && (
                <DropdownMenuItem onClick={onOpenSettingsManager}>
                  <SlidersHorizontal className="mr-2 h-4 w-4 text-foreground" />
                  <span>{t("settingsManager.title")}</span>
                </DropdownMenuItem>
              )}
              {onOpenArchive && (
                <DropdownMenuItem onClick={onOpenArchive} disabled={archiveDisabled}>
                  <Archive className="mr-2 h-4 w-4 text-foreground" />
                  <span>
                    {archiveDisabled
                      ? t("common.settings.claudeOnly", { name: t("archive.title") })
                      : t("archive.title")}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel>{t('common.settings.title')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => openModal("folderSelector", { mode: "change" })}
          >
            <Folder className="mr-2 h-4 w-4 text-foreground" />
            <span>{t('common.settings.changeFolder')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openModal("feedback")}>
            <MessageSquare className="mr-2 h-4 w-4 text-foreground" />
            <span>{t("feedback.title")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <FilterMenuGroup />

          <DropdownMenuSeparator />
          <FontMenuGroup />

          <DropdownMenuSeparator />
          <AccessibilityMenuGroup />

          <DropdownMenuSeparator />
          <ThemeMenuGroup />

          <DropdownMenuSeparator />
          <LanguageMenuGroup />

          <DesktopOnly>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                window.dispatchEvent(new Event('manual-update-check'));
              }}
              disabled={updater.state.isChecking}
            >
              <RefreshCw
                className={cn(
                  "mr-2 h-4 w-4 text-foreground",
                  updater.state.isChecking && "animate-spin"
                )}
              />
              {updater.state.isChecking
                ? t('common.settings.checking')
                : t('common.settings.checkUpdate')}
            </DropdownMenuItem>
          </DesktopOnly>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
