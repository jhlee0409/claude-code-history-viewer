import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/store/useAppStore";
import { useEffectiveHighContrast } from "@/hooks/useHighContrast";
import { useTranslation } from "react-i18next";
import { Contrast } from "lucide-react";

export const AccessibilityMenuGroup = () => {
  const { t } = useTranslation();
  const setHighContrast = useAppStore((s) => s.setHighContrast);
  // Shows what is on now (the OS setting until the user chooses); a click stores the opposite as the choice.
  const highContrast = useEffectiveHighContrast();

  return (
    <>
      <DropdownMenuLabel>
        {t("common.settings.accessibility.title")}
      </DropdownMenuLabel>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => void setHighContrast(!highContrast)}
      >
        <Contrast className="mr-2 h-4 w-4 text-foreground" />
        <span className="flex-1">
          {t("common.settings.accessibility.highContrast")}
        </span>
        <Switch
          checked={highContrast}
          aria-hidden="true"
          tabIndex={-1}
          className="ml-2"
        />
      </DropdownMenuItem>
    </>
  );
};
