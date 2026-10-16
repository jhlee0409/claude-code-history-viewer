/**
 * Phones: no tab strip (plan §9b "모바일 탭"). The toolbar shows how many
 * tabs are open; the button opens a sheet listing them, where a tab is
 * opened, closed, or a new one started. Tabs stay stored and show in the
 * strip again on a wider window.
 *
 * Focus (WCAG 2.4.3): the count button is the sheet's trigger, so closing
 * the sheet - Escape, opening a tab, a new tab - gives focus back to it;
 * closing a tab in the list moves focus to the row that takes its place.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { activateTab, closeTab, newTab, type TabScreens } from "@/navigation/tabs";
import { useTabItems } from "./useTabItems";

/** The tab icon's colour: a problem, the open tab, or any other tab. */
function glyphTone(item: { unavailable: boolean; active: boolean }): string {
  if (item.unavailable) return "text-destructive";
  return item.active ? "text-accent" : "text-muted-foreground";
}

export function MobileTabsButton({ screens }: { screens: TabScreens }) {
  const { t } = useTranslation();
  const items = useTabItems();
  const [open, setOpen] = useState(false);
  const count = items.length;
  const label = t("common.tabs.count", { count });
  const listRef = useRef<HTMLUListElement>(null);
  // The row whose close button takes focus once a closed row has gone.
  const focusRowRef = useRef<number | null>(null);
  useEffect(() => {
    const row = focusRowRef.current;
    if (row === null) return;
    focusRowRef.current = null;
    const closers = listRef.current?.querySelectorAll<HTMLElement>("[data-tab-row-close]");
    if (closers && closers.length > 0) closers[Math.min(row, closers.length - 1)]!.focus();
  }, [items]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          data-mobile-tabs=""
          aria-label={label}
          title={label}
          className="md:hidden inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border-[1.5px] border-current px-1 text-caption font-semibold tabular-nums leading-none">
            {count}
          </span>
        </button>
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[75vh] p-0 rounded-t-xl" showCloseButton={false}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-border/50">
          <SheetTitle className="text-body font-semibold text-foreground">{label}</SheetTitle>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void newTab();
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-list text-foreground hover:bg-muted"
          >
            <Plus className="w-4 h-4" />
            {t("common.command.newTab")}
          </button>
        </div>
        <ul ref={listRef} className="max-h-[calc(75vh-3.5rem)] overflow-y-auto py-1">
          {items.map((item, index) => {
            const Glyph = item.unavailable ? CircleAlert : item.icon;
            return (
              <li key={item.id} className="flex items-center gap-1 px-2">
                <button
                  type="button"
                  aria-current={item.active ? "page" : undefined}
                  onClick={() => {
                    setOpen(false);
                    if (!item.active) void activateTab(item.id, screens);
                  }}
                  className={cn(
                    "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-list",
                    item.active ? "bg-accent/15 text-foreground font-medium" : "text-foreground/85 hover:bg-muted"
                  )}
                >
                  <Glyph className={cn("w-4 h-4 shrink-0", glyphTone(item))} />
                  <span className="truncate">{item.label}</span>
                </button>
                <button
                  type="button"
                  data-tab-row-close=""
                  aria-label={t("common.tabs.closeNamed", { name: item.label })}
                  onClick={() => {
                    focusRowRef.current = index;
                    void closeTab(item.id, screens);
                  }}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
