import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Settings, RefreshCw, MessageSquare, Folder, Download, Loader2 } from "lucide-react";

import { cn } from "@/utils/cn";
import { COLORS } from "@/constants/colors";

import { useGitHubUpdater } from "@/hooks/useGitHubUpdater";
import { useSmartUpdater } from "@/hooks/useSmartUpdater";
import { useTranslation } from "react-i18next";
import { useModal } from "@/contexts/modal";
import { ThemeMenuGroup } from "./ThemeMenuGroup";
import { LanguageMenuGroup } from "./LanguageMenuGroup";

export const SettingDropdown = () => {
  const manualUpdater = useGitHubUpdater();
  const smartUpdater = useSmartUpdater();
  const { t } = useTranslation("common");
  const { t: tComponents } = useTranslation("components");
  const { openModal } = useModal();

  // 자동 또는 수동 업데이트 체크 중인지 확인
  const isCheckingForUpdates = manualUpdater.state.isChecking || smartUpdater.state.isChecking;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "p-2 rounded-lg transition-colors cursor-pointer relative",
              COLORS.ui.text.disabled,
              "hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800"
            )}
          >
            <Settings className={cn("w-5 h-5", COLORS.ui.text.primary)} />
            {isCheckingForUpdates && (
              <Loader2 className="absolute -top-1 -right-1 w-3 h-3 animate-spin text-blue-500" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t("settings.title")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => openModal("folderSelector", { mode: "change" })}
          >
            <Folder className={cn("mr-2 h-4 w-4", COLORS.ui.text.primary)} />
            <span>{t("settings.changeFolder")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openModal("feedback")}>
            <MessageSquare
              className={cn("mr-2 h-4 w-4", COLORS.ui.text.primary)}
            />
            <span>{tComponents("feedback.title")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.dispatchEvent(new Event("open-update-settings"))}>
            <Download
              className={cn("mr-2 h-4 w-4", COLORS.ui.text.primary)}
            />
            <span>{t("settings.updateSettings")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ThemeMenuGroup />

          <DropdownMenuSeparator />
          <LanguageMenuGroup />

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              window.dispatchEvent(new Event("manual-update-check"));
              manualUpdater.checkForUpdates(true); // 강제 체크
            }}
            disabled={manualUpdater.state.isChecking}
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                manualUpdater.state.isChecking ? "animate-spin" : "",
                COLORS.ui.text.primary
              )}
            />
            {manualUpdater.state.isChecking
              ? t("settings.checking")
              : t("settings.checkUpdate")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
