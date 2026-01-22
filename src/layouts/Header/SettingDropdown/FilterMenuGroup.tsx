import {
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export const FilterMenuGroup = () => {
  const { t } = useTranslation("common");
  const { showSystemMessages, setShowSystemMessages } = useAppStore();

  return (
    <>
      <DropdownMenuLabel>{t("settings.filter.title", { defaultValue: "필터" })}</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={showSystemMessages}
        onCheckedChange={setShowSystemMessages}
      >
        <Eye className="mr-2 h-4 w-4 text-foreground" />
        <span>{t("settings.filter.showSystemMessages", { defaultValue: "시스템 메시지 표시" })}</span>
      </DropdownMenuCheckboxItem>
    </>
  );
};
