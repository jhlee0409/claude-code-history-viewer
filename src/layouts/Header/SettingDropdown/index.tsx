import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Settings, RefreshCw, MessageSquare, Folder, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { useUpdater } from "@/hooks/useUpdater";
import { useTranslation } from "react-i18next";
import { useModal } from "@/contexts/modal";
import { ThemeMenuGroup } from "./ThemeMenuGroup";
import { LanguageMenuGroup } from "./LanguageMenuGroup";
import { FilterMenuGroup } from "./FilterMenuGroup";

export const SettingDropdown = () => {
  const updater = useUpdater();
  const { t } = useTranslation();
  const { openModal } = useModal();

  const isCheckingForUpdates = updater.state.isChecking;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-2 rounded-lg transition-colors cursor-pointer relative text-muted-foreground/50 hover:text-foreground/80 hover:bg-muted"
          >
            <Settings className="w-5 h-5 text-foreground" />
            {isCheckingForUpdates && (
              <Loader2 className="absolute -top-1 -right-1 w-3 h-3 animate-spin text-blue-500" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
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
          <ThemeMenuGroup />

          <DropdownMenuSeparator />
          <LanguageMenuGroup />

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
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
