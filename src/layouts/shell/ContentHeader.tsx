/**
 * The title block above a screen's body: icon, title and subtitle, all from
 * the screen's registry entry. Screens without a `header` entry get none.
 */
import { useTranslation } from "react-i18next";
import type { ClaudeSession } from "@/types";
import type { View } from "@/navigation/place";
import { VIEW_REGISTRY } from "./viewRegistry";

interface ContentHeaderProps {
  view: View;
  selectedSession: ClaudeSession | null;
  globalOverviewDescription: string;
}

export const ContentHeader = ({
  view,
  selectedSession,
  globalOverviewDescription,
}: ContentHeaderProps) => {
  const { t } = useTranslation();
  const { header, icon: Icon, titleKey } = VIEW_REGISTRY[view];
  if (!header) return null;

  return (
    <div className="px-4 py-3 md:px-6 md:py-4 border-b border-border/50 bg-card/50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-body font-semibold text-foreground">{t(titleKey)}</h2>
          <p className="text-list text-muted-foreground">
            {header.subtitle({ t, selectedSession, globalOverviewDescription })}
          </p>
        </div>
      </div>
    </div>
  );
};
