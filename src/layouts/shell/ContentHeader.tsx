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
  /** Opens the entry's related screen (`related`). */
  onOpenView?: (view: View) => void;
}

export const ContentHeader = ({
  view,
  selectedSession,
  globalOverviewDescription,
  onOpenView,
}: ContentHeaderProps) => {
  const { t } = useTranslation();
  const { header, icon: Icon, titleKey, related } = VIEW_REGISTRY[view];
  if (!header) return null;
  const RelatedIcon = related ? VIEW_REGISTRY[related.view].icon : null;

  return (
    <div className="px-4 py-3 md:px-6 md:py-4 border-b border-border/50 bg-card/50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-foreground">{t(titleKey)}</h2>
          <p className="text-list text-muted-foreground">
            {header.subtitle({ t, selectedSession, globalOverviewDescription })}
          </p>
        </div>
        {related && RelatedIcon && onOpenView && (
          <button
            type="button"
            onClick={() => onOpenView(related.view)}
            data-related-view={related.view}
            className="hidden md:inline-flex h-7 shrink-0 items-center gap-1.5 px-2.5 rounded-md border border-border/60 text-list text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <RelatedIcon className="w-4 h-4" aria-hidden="true" />
            {t(related.labelKey)}
          </button>
        )}
      </div>
    </div>
  );
};
