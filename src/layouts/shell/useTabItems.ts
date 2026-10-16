/**
 * What each conversation tab shows in the tab strip and the mobile tab list
 * (plan T8): its screen icon and a label naming its place.
 *
 * The active tab is read from the live store (it is the live state, see
 * `documentSlice`); every other tab from its snapshot.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { VIEW_REGISTRY } from "@/layouts/shell/viewRegistry";
import { isAppView, type View } from "@/navigation/place";
import type { TabDocument } from "@/navigation/documents";
import { getProjectDisplayName } from "@/utils/pathUtils";

/** The DOM id of a tab in the strip. */
export const documentTabId = (id: string) => `document-tab-${id}`;

export interface TabItem {
  id: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  unavailable: boolean;
}

interface LabelParts {
  view: View;
  projectName: string | null;
  sessionTitle: string | null;
  sessionId: string | null;
  unavailable: boolean;
}

type Translate = (key: string) => string;

/** The tab's label: the conversation, the project's screen, or the app screen. */
export function tabLabel(parts: LabelParts, t: Translate): string {
  const { view, projectName, sessionTitle, sessionId } = parts;
  if (isAppView(view)) return t(VIEW_REGISTRY[view].titleKey);
  if (!projectName) return t(parts.unavailable ? "common.tabs.unavailableTitle" : "common.tabs.empty");
  if (view === "conversation" || view === "empty") {
    if (sessionTitle) return sessionTitle;
    if (sessionId) return `${t("session.title")} ${sessionId.slice(-8)}`;
    return projectName;
  }
  return `${projectName} · ${t(VIEW_REGISTRY[view].titleKey)}`;
}

const partsOf = (doc: TabDocument): LabelParts => ({
  view: doc.view,
  projectName: doc.projectName ?? (doc.project ? doc.project.path.split("/").pop() ?? doc.project.path : null),
  sessionTitle: doc.title,
  sessionId: doc.session?.sessionId ?? null,
  unavailable: doc.unavailable !== null,
});

/** The tabs as the strip and the mobile list render them. */
export function useTabItems(): TabItem[] {
  const { t } = useTranslation();
  const documents = useAppStore((s) => s.documents);
  const activeId = useAppStore((s) => s.activeDocumentId);
  const hydrated = useAppStore((s) => s.hydratedDocumentId === s.activeDocumentId);
  const view = useAppStore((s) => s.view);
  const projectName = useAppStore((s) => (s.selectedProject ? getProjectDisplayName(s.selectedProject) : null));
  const sessionTitle = useAppStore((s) => s.selectedSession?.summary ?? null);
  const sessionId = useAppStore((s) => s.selectedSession?.session_id ?? null);

  return useMemo(
    () =>
      documents.map((doc) => {
        const active = doc.id === activeId;
        const parts =
          active && hydrated && !doc.unavailable
            ? { view, projectName, sessionTitle, sessionId, unavailable: false }
            : partsOf(doc);
        return {
          id: doc.id,
          icon: VIEW_REGISTRY[parts.view].icon,
          label: tabLabel(parts, t),
          active,
          unavailable: doc.unavailable !== null,
        };
      }),
    [documents, activeId, hydrated, view, projectName, sessionTitle, sessionId, t],
  );
}
