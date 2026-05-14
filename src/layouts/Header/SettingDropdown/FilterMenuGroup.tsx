import {
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { Bot, Eye } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export const FilterMenuGroup = () => {
  const { t } = useTranslation();
  const {
    showSystemMessages,
    setShowSystemMessages,
    excludeSidechain,
    setExcludeSidechain,
  } = useAppStore();
  const showSubagentMessages = !excludeSidechain;

  return (
    <>
      <DropdownMenuLabel>
        {t("common.settings.filter.title", { defaultValue: "필터" })}
      </DropdownMenuLabel>
      <DropdownMenuItem
        role="menuitemcheckbox"
        aria-checked={showSystemMessages}
        onSelect={(e) => {
          e.preventDefault();
          setShowSystemMessages(!showSystemMessages);
        }}
      >
        <Eye className="mr-2 h-4 w-4 text-foreground" />
        <span className="flex-1">
          {t("common.settings.filter.showSystemMessages", {
            defaultValue: "시스템 메시지 표시",
          })}
        </span>
        <Switch
          checked={showSystemMessages}
          aria-hidden="true"
          tabIndex={-1}
          className="ml-2"
        />
      </DropdownMenuItem>
      <DropdownMenuItem
        role="menuitemcheckbox"
        aria-checked={showSubagentMessages}
        onSelect={(e) => {
          e.preventDefault();
          setExcludeSidechain(!excludeSidechain);
        }}
      >
        <Bot className="mr-2 h-4 w-4 text-foreground" />
        <span className="flex-1">
          {t("common.settings.filter.showSubagentMessages", {
            defaultValue: "서브에이전트 메시지 표시",
          })}
        </span>
        <Switch
          checked={showSubagentMessages}
          aria-hidden="true"
          tabIndex={-1}
          className="ml-2"
        />
      </DropdownMenuItem>
    </>
  );
};
