/**
 * The phone's analytics navigation: one segmented row, Overview · Tokens ·
 * Edits, under the content header (owner decision, T9b follow-up).
 *
 * Phones used to stack two rows here: analytics | edits chips, then the
 * analytics sub-tabs (Overview | Tokens) inside the dashboard. This row
 * replaces both. Each item is a place - analytics with its overview or
 * tokens sub-tab, or the Edits screen - and choosing one navigates there, so
 * the row is a `nav` of buttons with `aria-current="page"` on the current
 * place, not a tablist: Edits is another screen, not a panel of this one.
 * Every item is a native button in the tab order (Tab, Enter/Space).
 *
 * The desktop keeps the sub-tabs inside analytics (`AnalyticsSubTabs`) and
 * Edits as a toolbar view; AppLayout mounts this row on phones only.
 */
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { useAppStore } from "@/store/useAppStore";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { MobileAnalyticsView } from "./viewRegistry";

type Actions = UseAnalyticsReturn["actions"];

/** A place the row reaches. */
export type MobileAnalyticsPlace = "overview" | "tokens" | "edits";

interface PlaceItem {
  id: MobileAnalyticsPlace;
  labelKey: string;
  icon: LucideIcon;
  open: (actions: Actions) => Promise<void>;
}

/** In display order. Labels are the desktop sub-tabs' and the Edits screen's. */
const MOBILE_ANALYTICS_PLACES: readonly PlaceItem[] = [
  {
    id: "overview",
    labelKey: "analytics.subTab.overview",
    icon: SCREEN_ICONS.analytics,
    open: (actions) => actions.switchToAnalytics("overview"),
  },
  {
    id: "tokens",
    labelKey: "analytics.subTab.tokens",
    icon: SCREEN_ICONS.tokenStats,
    open: (actions) => actions.switchToAnalytics("tokens"),
  },
  {
    id: "edits",
    labelKey: "recentEdits.title",
    icon: SCREEN_ICONS.edits,
    open: (actions) => actions.switchToRecentEdits(),
  },
];

interface MobileAnalyticsSubNavProps {
  view: MobileAnalyticsView;
  analyticsActions: Actions;
}

export const MobileAnalyticsSubNav = ({ view, analyticsActions }: MobileAnalyticsSubNavProps) => {
  const { t } = useTranslation();
  const analyticsTab = useAppStore((s) => s.analyticsTab);
  const current: MobileAnalyticsPlace = view === "edits" ? "edits" : analyticsTab;

  return (
    <nav
      aria-label={t("analytics.subTab.label")}
      data-mobile-analytics-nav=""
      className="px-3 py-2 border-b border-border/40 bg-card/30 md:hidden"
    >
      <div className="segmented w-full">
        {MOBILE_ANALYTICS_PLACES.map((place) => {
          const selected = place.id === current;
          return (
            <button
              key={place.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              data-analytics-place={place.id}
              onClick={() => {
                if (selected) return;
                // The screen's own loader records a failure on screen (its
                // error state); the log keeps the cause.
                place.open(analyticsActions).catch((error: unknown) => {
                  console.error(`Failed to open ${place.id} from the analytics nav:`, error);
                });
              }}
              className="segmented-item flex flex-1 min-w-0 items-center justify-center gap-1.5 px-2 py-2.5 text-list whitespace-nowrap"
            >
              <Icon
                icon={place.icon}
                size={14}
                aria-hidden="true"
                className={selected ? "shrink-0 text-accent" : "shrink-0 text-muted-foreground/70"}
              />
              {t(place.labelKey)}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
