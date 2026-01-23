import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { supportedLanguages, type SupportedLanguage } from "@/i18n";
import { useLanguageStore } from "@/store/useLanguageStore";
import { useTranslation } from "react-i18next";

export const LanguageMenuGroup = () => {
  const { language, setLanguage } = useLanguageStore();
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenuLabel>{t('common.settings.language.title')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={language}
        onValueChange={(value) => setLanguage(value as SupportedLanguage)}
      >
        {Object.entries(supportedLanguages).map(([code, name]) => (
          <DropdownMenuRadioItem key={code} value={code}>
            <span>{name}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
};
