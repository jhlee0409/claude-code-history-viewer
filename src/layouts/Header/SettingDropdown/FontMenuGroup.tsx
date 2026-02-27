import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store/useAppStore";
import { useTranslation } from "react-i18next";
import { Type } from "lucide-react";

const FONT_SCALE_OPTIONS = [
  { value: 90, labelKey: "common.settings.font.90" as const },
  { value: 100, labelKey: "common.settings.font.100" as const },
  { value: 110, labelKey: "common.settings.font.110" as const },
  { value: 120, labelKey: "common.settings.font.120" as const },
  { value: 130, labelKey: "common.settings.font.130" as const },
];

export const FontMenuGroup = () => {
  const { t } = useTranslation();
  const { fontScale, setFontScale } = useAppStore();

  return (
    <>
      <DropdownMenuLabel>{t("common.settings.font.title")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={String(fontScale)}
        onValueChange={(value) => {
          const nextScale = Number(value);
          if (Number.isFinite(nextScale)) {
            void setFontScale(nextScale);
          }
        }}
      >
        {FONT_SCALE_OPTIONS.map(({ value, labelKey }) => (
          <DropdownMenuRadioItem key={value} value={String(value)}>
            <Type className="mr-2 h-4 w-4 text-foreground" />
            <span>
              {t(labelKey)} ({value}%)
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
};
