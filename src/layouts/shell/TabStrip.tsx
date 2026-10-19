/**
 * The conversation tab strip (plan T8, decision page §1): one tab per
 * document, under the toolbar and across the whole window, from md up.
 *
 *   [▣ Session title ×] [▥ project · Analytics ×] [ … ]   ⌄  +
 *
 * - A tab is a place (project + screen + session); clicking it switches to
 *   it (`activateTab`). The × closes it, as do middle-click, Delete and ⌘W.
 * - `role=tablist` with roving focus: arrows / Home / End move focus, Enter
 *   or Space opens the focused tab (manual activation: opening one loads a
 *   session). Closing the focused tab from the keyboard (Delete, ⌘W/⌥W)
 *   moves focus to the tab that takes its place - its right neighbour, else
 *   its left one, else the empty tab that replaces it - never to the page.
 * - Too many tabs to fit: the strip scrolls sideways (the active tab is kept
 *   in view) and a "⌄" menu lists every tab.
 *
 * Phones show no strip; the toolbar's tab-count button opens the same list
 * in a sheet (`MobileTabsButton`).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, CircleAlert, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipButton } from "@/shared/TooltipButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activateTab, closeTab, type TabScreens } from "@/navigation/tabs";
import { neighbourAfterClose } from "@/navigation/documents";
import { useCommandRunner } from "@/commands/CommandRunner";
import { shortcutLabel } from "@/commands/keys";
import { getCommand } from "@/commands/registry";
import { documentTabId, useTabItems, type TabItem } from "./useTabItems";

interface TabStripProps {
  screens: TabScreens;
}

const withShortcut = (label: string, commandId: "tab.new"): string => {
  const keys = shortcutLabel(getCommand(commandId)?.shortcut ?? null);
  return keys ? `${label} (${keys})` : label;
};

/** Where a navigation key moves focus in a list of `count` tabs, or null. */
function focusTarget(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function TabStrip({ screens }: TabStripProps) {
  const { t } = useTranslation();
  const items = useTabItems();
  const commands = useCommandRunner();
  const listRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  // Tabs hidden past either edge: that edge fades instead of cutting a tab.
  const [hidden, setHidden] = useState({ before: false, after: false });
  // The roving Tab stop follows focus; a new active tab takes it back.
  const [focusId, setFocusId] = useState<string | null>(null);
  const activeId = items.find((item) => item.active)?.id ?? null;
  const stopId = focusId && items.some((item) => item.id === focusId) ? focusId : activeId;

  useEffect(() => setFocusId(null), [activeId]);

  // Keyboard focus survives closing the focused tab (WCAG 2.4.3). The tab
  // that last had focus; the tab Delete chose to take it.
  const focusedIdRef = useRef<string | null>(null);
  const focusNextRef = useRef<string | null>(null);
  useEffect(() => {
    const lost = focusedIdRef.current;
    if (!lost || items.some((item) => item.id === lost)) return;
    focusedIdRef.current = null;
    const wanted = focusNextRef.current;
    focusNextRef.current = null;
    // Only when focus went down with the removed tab (to the page), not
    // when the user had already moved it elsewhere.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target = wanted && items.some((item) => item.id === wanted) ? wanted : (activeId ?? items[0]?.id);
    if (target) document.getElementById(documentTabId(target))?.focus();
  }, [items, activeId]);

  // Keep the active tab in view and track whether the strip overflows.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      setOverflowing(list.scrollWidth > list.clientWidth + 1);
      setHidden({
        before: list.scrollLeft > 1,
        after: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
      });
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    if (activeId) document.getElementById(documentTabId(activeId))?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [activeId, items.length]);

  const open = (id: string) => void activateTab(id, screens);
  const close = (id: string) => void closeTab(id, screens);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === (document.activeElement as HTMLElement | null)?.dataset.documentId);
    if (index === -1) return;
    const target = focusTarget(event.key, index, items.length);
    if (target === null) return;
    event.preventDefault();
    document.getElementById(documentTabId(items[target]!.id))?.focus();
  };

  return (
    <div
      data-slot="tabs"
      className="hidden md:flex h-8 shrink-0 items-end gap-1 pl-2 pr-2 bg-sidebar border-b border-border/50"
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("common.tabs.label")}
        onKeyDown={onKeyDown}
        className={cn(
          "flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          hidden.after && !hidden.before && "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
          hidden.before && !hidden.after && "[mask-image:linear-gradient(to_left,black_calc(100%-2rem),transparent)]",
          hidden.before && hidden.after &&
            "[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]"
        )}
      >
        {items.map((item) => (
          <DocumentTab
            key={item.id}
            item={item}
            tabStop={item.id === stopId}
            onFocus={() => {
              focusedIdRef.current = item.id;
              setFocusId(item.id);
            }}
            onBlur={() => {
              // Focus left a tab that is still there (a click elsewhere, Tab):
              // it no longer needs saving. A tab removed while focused keeps it.
              queueMicrotask(() => {
                if (focusedIdRef.current === item.id && document.getElementById(documentTabId(item.id))) {
                  focusedIdRef.current = null;
                }
              });
            }}
            onOpen={() => open(item.id)}
            onClose={() => close(item.id)}
            onCloseFromKeyboard={() => {
              focusNextRef.current = neighbourAfterClose(items, item.id);
              close(item.id);
            }}
            closeLabel={t("common.tabs.closeNamed", { name: item.label })}
          />
        ))}
      </div>

      {overflowing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("common.tabs.all", { count: items.length })}
              title={t("common.tabs.all", { count: items.length })}
              className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
            <DropdownMenuRadioGroup value={activeId ?? ""} onValueChange={open}>
              {items.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} className="text-list">
                  <item.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <TooltipButton
        type="button"
        onClick={() => commands.run("tab.new")}
        aria-label={t("common.command.newTab")}
        content={withShortcut(t("common.command.newTab"), "tab.new")}
        className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <Plus className="w-4 h-4" />
      </TooltipButton>
    </div>
  );
}

interface DocumentTabProps {
  item: TabItem;
  tabStop: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onOpen: () => void;
  onClose: () => void;
  /** Delete / Backspace on the focused tab: focus goes to the tab taking its place. */
  onCloseFromKeyboard: () => void;
  closeLabel: string;
}

function DocumentTab({ item, tabStop, onFocus, onBlur, onOpen, onClose, onCloseFromKeyboard, closeLabel }: DocumentTabProps) {
  const Glyph = item.unavailable ? CircleAlert : item.icon;
  return (
    <button
      type="button"
      role="tab"
      id={documentTabId(item.id)}
      data-document-id={item.id}
      aria-selected={item.active}
      aria-controls="main-content"
      aria-keyshortcuts="Delete"
      tabIndex={tabStop ? 0 : -1}
      title={item.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={() => {
        if (!item.active) onOpen();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onCloseFromKeyboard();
        }
      }}
      className={cn(
        "group relative flex h-7 min-w-[7.5rem] max-w-[13.75rem] flex-[0_1_13.75rem] items-center gap-1.5 rounded-t-md border border-b-0 pl-2 pr-1 text-list transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        item.active
          ? "bg-background text-foreground border-border/60"
          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <Glyph
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          item.unavailable ? "text-destructive" : item.active && "text-accent"
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate text-left", item.unavailable && "italic")}>{item.label}</span>
      {/* Pointer-only close; the keyboard closes with Delete or ⌘W. */}
      <span
        aria-hidden="true"
        title={closeLabel}
        data-tab-close=""
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20",
          item.active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70"
        )}
      >
        <X className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
