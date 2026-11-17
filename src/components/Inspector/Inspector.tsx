/**
 * The inspector (plan T9a, decision D5): one right-hand panel beside a
 * transcript, with three tabs.
 *
 * - Outline: the message navigator (#632), moved as is (`embedded`).
 * - Tokens: the session's token usage (`InspectorTokensTab`).
 * - Info: what the session is (`InspectorInfoTab`).
 *
 * The panel owns the landmark, the width and its resize handle, the tab
 * strip and the close button. Open state, tab and width are window-wide
 * preferences kept in `inspectorSlice.ts`.
 *
 * Keyboard: the tab strip is one tab stop (APG tabs, automatic
 * activation): arrows, Home and End move between tabs. Escape anywhere in
 * the panel closes it and puts focus back on the toolbar's inspector button
 * (`inspectorFocus.ts`); it stops there, so it does not also reach the
 * window-level Escape handlers behind the panel (selection mode).
 */
import type React from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeMessage } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import { INSPECTOR_TAB_IDS, type InspectorTabId } from "@/store/slices/inspectorSlice";
import { MessageNavigator } from "@/components/MessageNavigator";
import { InspectorTokensTab } from "./InspectorTokensTab";
import { InspectorInfoTab } from "./InspectorInfoTab";
import { INSPECTOR_ID, closeInspector } from "./inspectorFocus";

const TAB_LABEL_KEY: Record<InspectorTabId, string> = {
  outline: "common.inspector.tab.outline",
  tokens: "common.inspector.tab.tokens",
  info: "common.inspector.tab.info",
};

const inspectorTabId = (tab: InspectorTabId) => `${INSPECTOR_ID}-tab-${tab}`;
const inspectorPanelId = (tab: InspectorTabId) => `${INSPECTOR_ID}-panel-${tab}`;

interface InspectorProps {
  messages: ClaudeMessage[];
  width: number;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent<HTMLElement>) => void;
}

export const Inspector = ({ messages, width, isResizing, onResizeStart }: InspectorProps) => {
  const { t } = useTranslation();
  const selectedTab = useAppStore((s) => s.inspectorTab);
  const setInspectorTab = useAppStore((s) => s.setInspectorTab);
  const tabRefs = useRef(new Map<InspectorTabId, HTMLButtonElement>());

  const selectTab = (tab: InspectorTabId, focus: boolean) => {
    setInspectorTab(tab);
    if (focus) tabRefs.current.get(tab)?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = INSPECTOR_TAB_IDS.indexOf(selectedTab);
    const last = INSPECTOR_TAB_IDS.length - 1;
    const next = (() => {
      switch (event.key) {
        case "ArrowRight":
          return INSPECTOR_TAB_IDS[index === last ? 0 : index + 1];
        case "ArrowLeft":
          return INSPECTOR_TAB_IDS[index === 0 ? last : index - 1];
        case "Home":
          return INSPECTOR_TAB_IDS[0];
        case "End":
          return INSPECTOR_TAB_IDS[last];
        default:
          return null;
      }
    })();
    if (next === null || next === undefined) return;
    event.preventDefault();
    selectTab(next, true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    closeInspector();
  };

  const panel = (() => {
    switch (selectedTab) {
      case "outline":
        return (
          <MessageNavigator
            messages={messages}
            isResizing={isResizing}
            onResizeStart={onResizeStart}
            isCollapsed={false}
            onToggleCollapse={closeInspector}
            asideId="message-navigator"
            embedded
          />
        );
      case "tokens":
        return <InspectorTokensTab />;
      case "info":
        return <InspectorInfoTab />;
    }
  })();

  return (
    <aside
      id={INSPECTOR_ID}
      role="complementary"
      aria-label={t("common.toolbar.inspector")}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex h-full flex-col border-l border-border/50 bg-sidebar",
        isResizing && "select-none",
      )}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      {/* Resize handle (left edge): the panel grows leftward. */}
      <div
        className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50"
        onMouseDown={onResizeStart}
      />

      <div className="flex shrink-0 items-center gap-1 border-b border-border/50 px-2 py-1">
        <div
          role="tablist"
          aria-label={t("common.inspector.tabs")}
          className="flex min-w-0 flex-1 items-center gap-0.5"
        >
          {INSPECTOR_TAB_IDS.map((tab) => {
            const selected = tab === selectedTab;
            return (
              <button
                key={tab}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab, element);
                  else tabRefs.current.delete(tab);
                }}
                type="button"
                role="tab"
                id={inspectorTabId(tab)}
                aria-selected={selected}
                aria-controls={inspectorPanelId(tab)}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(tab, false)}
                onKeyDown={handleTabKeyDown}
                className={cn(
                  "min-w-0 truncate rounded-md px-1.5 py-1 text-list font-medium transition-colors",
                  selected
                    ? "bg-accent/15 text-foreground"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
                )}
              >
                {t(TAB_LABEL_KEY[tab])}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={closeInspector}
          aria-label={t("common.inspector.close")}
          title={t("common.inspector.close")}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        role="tabpanel"
        id={inspectorPanelId(selectedTab)}
        aria-labelledby={inspectorTabId(selectedTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {panel}
      </div>
    </aside>
  );
};
