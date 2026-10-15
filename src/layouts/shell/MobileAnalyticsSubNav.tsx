/**
 * Mobile analytics sub-nav: the project screens the tablist reaches on wider
 * layouts, as a chip row under the content header. Icons and titles come
 * from the registry; each chip opens its screen the way it always has.
 */
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { UseAnalyticsReturn } from "@/types/analytics";
import { MOBILE_ANALYTICS_VIEWS, VIEW_REGISTRY, type MobileAnalyticsView } from "./viewRegistry";

type Actions = UseAnalyticsReturn["actions"];

const OPEN: Record<MobileAnalyticsView, (actions: Actions) => Promise<void>> = {
  analytics: (actions) => actions.switchToAnalytics(),
  tokenStats: (actions) => actions.switchToTokenStats(),
  edits: (actions) => actions.switchToRecentEdits(),
};

interface MobileAnalyticsSubNavProps {
  view: MobileAnalyticsView;
  analyticsActions: Actions;
}

export const MobileAnalyticsSubNav = ({ view, analyticsActions }: MobileAnalyticsSubNavProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-card/30 md:hidden overflow-x-auto">
      {MOBILE_ANALYTICS_VIEWS.map((chip) => {
        const { icon: Icon, titleKey } = VIEW_REGISTRY[chip];
        return (
          <button
            key={chip}
            type="button"
            onClick={() => OPEN[chip](analyticsActions)}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-3 py-2.5 md:py-1.5 rounded-lg text-xs font-medium transition-colors",
              chip === view
                ? "bg-accent/15 text-accent border border-accent/30"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {t(titleKey)}
          </button>
        );
      })}
    </div>
  );
};
