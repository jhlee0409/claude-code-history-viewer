import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store/useAppStore";
import { useTranslation } from "react-i18next";
import { Contrast } from "lucide-react";

export const AccessibilityMenuGroup = () => {
  const { t } = useTranslation();
  const { highContrast, setHighContrast } = useAppStore();

  return (
    <>
      <DropdownMenuLabel>{t("common.settings.accessibility.title")}</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={highContrast}
        onCheckedChange={(checked) => {
          void setHighContrast(checked === true);
        }}
      >
        <Contrast className="mr-2 h-4 w-4 text-foreground" />
        <span>{t("common.settings.accessibility.highContrast")}</span>
      </DropdownMenuCheckboxItem>
    </>
  );
};
