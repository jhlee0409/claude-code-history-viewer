import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";

import { Sun, Moon, Laptop } from "lucide-react";

import { useTheme } from "@/contexts/theme";

export const ThemeMenuGroup = () => {
  const { theme, setTheme } = useTheme();

  const { t } = useTranslation("common");

  const themeItems = [
    {
      icon: <Sun className="mr-2 h-4 w-4 text-foreground" />,
      label: t("settings.theme.light"),
      value: "light",
    },
    {
      icon: <Moon className="mr-2 h-4 w-4 text-foreground" />,
      label: t("settings.theme.dark"),
      value: "dark",
    },
    {
      icon: <Laptop className="mr-2 h-4 w-4 text-foreground" />,
      label: t("settings.theme.system"),
      value: "system",
    },
  ];

  return (
    <>
      <DropdownMenuLabel>{t("settings.theme.title")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={(value) => {
          if (value === "light" || value === "dark" || value === "system") {
            setTheme(value);
          }
        }}
      >
        {themeItems.map(({ icon, label, value }) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {icon}
            <span>{label}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
};
