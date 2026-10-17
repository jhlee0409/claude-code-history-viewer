/**
 * The project analytics sub-tabs (plan T9b): Overview | Tokens.
 *
 * Token statistics used to be a screen of their own, opened from a link in
 * the analytics header; they are now a sub-tab of analytics. The selected
 * sub-tab is part of the place (`analyticsTab`), so it is written through
 * navigation (back/forward, conversation tabs and stored tabs keep it) and
 * this control only reflects and requests it.
 *
 * An APG tablist with automatic activation: one tab stop (the selected tab),
 * Arrow keys / Home / End move and select. Same on every width; on phones it
 * is how token statistics are reached from the analytics bottom tab.
 */
import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon/Icon";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { cn } from "@/lib/utils";
import { ANALYTICS_TABS, type AnalyticsTab } from "@/navigation/place";
import { ANALYTICS_SUBTAB_PANEL_ID, analyticsSubTabId } from "./analyticsSubTabIds";

const LABEL_KEYS: Record<AnalyticsTab, string> = {
  overview: "analytics.subTab.overview",
  tokens: "analytics.subTab.tokens",
};

const ICONS = {
  overview: SCREEN_ICONS.analytics,
  tokens: SCREEN_ICONS.tokenStats,
} as const;

interface AnalyticsSubTabsProps {
  value: AnalyticsTab;
  onChange: (tab: AnalyticsTab) => void;
}

export const AnalyticsSubTabs = ({ value, onChange }: AnalyticsSubTabsProps) => {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<AnalyticsTab, HTMLButtonElement | null>>>({});

  const select = (tab: AnalyticsTab) => {
    refs.current[tab]?.focus();
    if (tab !== value) onChange(tab);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ANALYTICS_TABS.indexOf(value);
    const last = ANALYTICS_TABS.length - 1;
    const next: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    select(ANALYTICS_TABS[next[event.key]!]!);
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-5">
      <div
        role="tablist"
        aria-label={t("analytics.subTab.label")}
        onKeyDown={onKeyDown}
        className="flex w-fit items-center gap-1 rounded-lg bg-muted/40 p-1"
      >
        {ANALYTICS_TABS.map((tab) => {
          const selected = tab === value;
          return (
            <button
              key={tab}
              ref={(node) => {
                refs.current[tab] = node;
              }}
              id={analyticsSubTabId(tab)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={ANALYTICS_SUBTAB_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              data-analytics-tab={tab}
              onClick={() => select(tab)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-list font-medium transition-colors whitespace-nowrap",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                icon={ICONS[tab]}
                size={14}
                aria-hidden="true"
                className={selected ? "text-accent" : "text-muted-foreground/70"}
              />
              {t(LABEL_KEYS[tab])}
            </button>
          );
        })}
      </div>
    </div>
  );
};
