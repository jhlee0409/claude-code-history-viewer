import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Settings, RefreshCw, Folder, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import { useTranslation } from "react-i18next";
import { useModal } from "@/contexts/modal";
import { DesktopOnly } from "@/contexts/platform";
import { ThemeMenuGroup } from "./ThemeMenuGroup";
import { LanguageMenuGroup } from "./LanguageMenuGroup";
import { FilterMenuGroup } from "./FilterMenuGroup";
import { ViewMenuGroup } from "./ViewMenuGroup";
import { FontMenuGroup } from "./FontMenuGroup";
import { AccessibilityMenuGroup } from "./AccessibilityMenuGroup";

interface SettingDropdownProps {
  updater: UseUpdaterReturn;
}

/**
 * The gear menu: app preferences only (plan T7, D8) - the Claude folder,
 * message filters, view, font, accessibility, theme, language, and on the
 * desktop the app's own update check. The Claude Code tools (Settings
 * Manager, Archive) live in the sidebar library and the ⌘K palette; feedback
 * is the sidebar's help button and a palette command (§6).
 */
export const SettingDropdown = ({ updater }: SettingDropdownProps) => {
  const { t } = useTranslation();
  const { openModal } = useModal();

  const isCheckingForUpdates = updater.state.isChecking;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            id="app-settings-button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer relative text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={t("common.settings.title")}
          >
            <Settings className="w-4 h-4" />
            {isCheckingForUpdates && (
              <LoaderCircle className="absolute -top-1 -right-1 w-3.5 h-3.5 animate-spin text-info" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{t('common.settings.title')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => openModal("folderSelector", { mode: "change" })}
          >
            <Folder className="mr-2 h-4 w-4 text-foreground" />
            <span>{t('common.settings.changeFolder')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <FilterMenuGroup />

          <DropdownMenuSeparator />
          <ViewMenuGroup />

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
