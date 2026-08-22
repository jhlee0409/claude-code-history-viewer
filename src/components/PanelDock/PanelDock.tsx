/**
 * PanelDock
 *
 * A minimal host for right-hand panels. Clones the shell concerns proven by
 * `MessageNavigator`: a resizable `aside` with `role="complementary"`, a
 * left-edge resize handle (right-side panels grow leftward), and an id that
 * `AppLayout`'s skip link targets.
 *
 * With one group holding one tab it renders no chrome of its own: no tab strip,
 * no dock-level header. That is deliberate, so every UI decision made for the
 * standalone Recent Edits rail survives untouched.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { PanelDefinition, PanelGroup, PanelId } from "./types";

export interface PanelDockProps {
  groups: PanelGroup[];
  panels: Record<PanelId, PanelDefinition>;
  /** Switch the active tab within a group. Unreachable while a group has one tab. */
  onActivateTab?: (groupIndex: number, tab: PanelId) => void;
  onResizeStart?: (
    groupIndex: number,
    event: React.MouseEvent<HTMLElement>
  ) => void;
  isResizing?: boolean;
  asideId?: string;
}

export const PanelDock: React.FC<PanelDockProps> = ({
  groups,
  panels,
  onActivateTab,
  onResizeStart,
  isResizing = false,
  asideId = "panel-dock",
}) => {
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((group, groupIndex) => {
        const active = panels[group.activeTab];
        if (!active) return null;

        const hasTabStrip = group.tabs.length > 1;
        // One group keeps the stable id the skip link points at; a future
        // split gives later groups their own.
        const id = groupIndex === 0 ? asideId : `${asideId}-${groupIndex}`;

        return (
          <aside
            key={id}
            id={id}
            role="complementary"
            aria-label={active.title}
            tabIndex={-1}
            className={cn(
              "relative flex h-full flex-col border-l border-border/50 bg-sidebar",
              isResizing && "select-none"
            )}
            style={{
              width: group.size,
              minWidth: group.size,
              maxWidth: group.size,
            }}
          >
            {/* Handle is on the LEFT edge: this panel grows leftward. */}
            <div
              className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50"
              onMouseDown={(event) => onResizeStart?.(groupIndex, event)}
            />

            {hasTabStrip && (
              <div
                role="tablist"
                aria-label={active.title}
                className="flex items-center gap-1 border-b border-border/50 px-1 pt-1"
              >
                {group.tabs.map((tabId) => {
                  const tab = panels[tabId];
                  if (!tab) return null;
                  const selected = tabId === group.activeTab;
                  return (
                    <button
                      key={tabId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => onActivateTab?.(groupIndex, tabId)}
                      className={cn(
                        "rounded-t-md px-3 py-1.5 text-px11 font-medium transition-colors",
                        selected
                          ? "bg-card text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab.title}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="min-h-0 flex-1">{active.render()}</div>
          </aside>
        );
      })}
    </>
  );
};

PanelDock.displayName = "PanelDock";
