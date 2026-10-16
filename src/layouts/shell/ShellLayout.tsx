/**
 * ShellLayout: the app's frame, as named slots (plan T3).
 *
 *   ┌──────────────────────── header ────────────────────────┐
 *   │ sidebar │ list │ main (mainHeader + view panel) │ inspector │
 *   └────────────────────── statusBar ───────────────────────┘
 *
 * - `sidebar`: the project explorer.
 * - `list`: the sessions column (stays a slot until T7 removes it).
 * - `main`: the `<main>` landmark; `mainHeader` sits above the view panel,
 *   `main` fills the panel. The panel is the header tabs' tabpanel while a
 *   tab labels it (`mainLabelledBy`).
 * - `inspector`: the right-hand surfaces of the current screen (today the
 *   message navigator and the recent-edits dock; T9a's inspector).
 *
 * Layout only: the shell decides where slots go, never what fills them.
 */
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VIEW_PANEL_ID } from "@/layouts/Header/viewTabIds";

export interface ShellLayoutProps {
  /** Non-visual settle marker for the UI capture harness (`data-ready`). */
  ready: boolean;
  skipLinks: ReactNode;
  header: ReactNode;
  /** Off-canvas navigation (the mobile drawer). */
  drawer?: ReactNode;
  sidebar?: ReactNode;
  list?: ReactNode;
  mainHeader?: ReactNode;
  main: ReactNode;
  /** Id of the tab that labels the view panel; the panel is a tabpanel only then. */
  mainLabelledBy?: string;
  inspector?: ReactNode;
  statusBar: ReactNode;
  /** Live region, update manager, mobile tab bar and sheets. */
  chrome?: ReactNode;
  /** Rendered outside the app root (portaled dialogs). */
  modals?: ReactNode;
}

export const ShellLayout = ({
  ready,
  skipLinks,
  header,
  drawer,
  sidebar,
  list,
  mainHeader,
  main,
  mainLabelledBy,
  inspector,
  statusBar,
  chrome,
  modals,
}: ShellLayoutProps) => (
  <TooltipProvider>
    <div className="h-screen flex flex-col bg-background" data-ready={String(ready)}>
      {skipLinks}
      {header}
      {drawer}
      <div className="flex-1 flex overflow-hidden">
        {sidebar}
        {list}
        <main
          id="main-content"
          data-slot="main"
          tabIndex={-1}
          className="flex-1 flex flex-col min-w-0 bg-background pb-[var(--mobile-bottom-inset)] md:pb-0"
        >
          {mainHeader}
          <div
            id={VIEW_PANEL_ID}
            role={mainLabelledBy ? "tabpanel" : undefined}
            aria-labelledby={mainLabelledBy}
            className="flex-1 overflow-hidden"
          >
            {main}
          </div>
        </main>
        {inspector}
      </div>
      {statusBar}
      {chrome}
    </div>
    {modals}
  </TooltipProvider>
);
