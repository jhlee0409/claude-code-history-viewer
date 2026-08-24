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
        const headingId = `${id}-title`;

        return (
          <aside
            key={id}
            id={id}
            role="complementary"
            /*
              With a tab strip the tabs name the panel, so the landmark carries
              its own label. With a single panel the heading below is the name,
              so the landmark points at it rather than repeating the string,
              which would otherwise be announced twice.
            */
            aria-label={hasTabStrip ? active.title : undefined}
            aria-labelledby={hasTabStrip ? undefined : headingId}
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

            {/*
              A single panel gets a plain heading where a group of panels gets
              its tab strip. Without this the dock opened with no visible name
              at all: the title existed only as the landmark's accessible name,
              so a sighted user had nothing telling them what the panel was.
            */}
            {!hasTabStrip && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-2 py-2">
                {active.icon}
                {/*
                  A floor rather than `min-w-0`. `min-w-0` lets a flex child
                  shrink past its content, which would collapse the title to
                  nothing and leave the action sitting alone on the row. With a
                  floor the action wraps instead, and the title truncates.
                */}
                <div className="min-w-[7rem] flex-1">
                  <h2
                    id={headingId}
                    className="truncate text-sm font-bold tracking-tight text-foreground"
                  >
                    {active.title}
                  </h2>
                  {active.subtitle && (
                    <p className="truncate text-px11 text-muted-foreground">
                      {active.subtitle}
                    </p>
                  )}
                </div>
                {active.headerAction && (
                  <div className="ml-auto flex shrink-0 items-center">
                    {active.headerAction}
                  </div>
                )}
              </div>
            )}

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
