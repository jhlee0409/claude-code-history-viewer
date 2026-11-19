/** The registered page title/subtitle, using the shared h1/header contract. */
import { useTranslation } from "react-i18next";
import type { ClaudeSession } from "@/types";
import type { View } from "@/navigation/place";
import { PageHeader } from "@/components/ui/pageHeader";
import { VIEW_REGISTRY } from "./viewRegistry";

interface ContentHeaderProps {
  view: View;
  selectedSession: ClaudeSession | null;
  globalOverviewDescription: string;
}

export const ContentHeader = ({ view, selectedSession, globalOverviewDescription }: ContentHeaderProps) => {
  const { t } = useTranslation();
  const { header, titleKey } = VIEW_REGISTRY[view];
  if (!header) return null;
  return <PageHeader title={t(titleKey)}
    description={header.subtitle({ t, selectedSession, globalOverviewDescription })}
    className="py-3 md:py-4 border-b border-border/50 bg-card/50" />;
};
