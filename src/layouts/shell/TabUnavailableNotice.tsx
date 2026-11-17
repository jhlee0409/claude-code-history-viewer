/**
 * The in-tab state of a tab that could not be opened (plan T8): its session
 * was deleted or moved, or its project is not scanned (removed, or its
 * assistant is turned off). The tab keeps its saved place, so it says what
 * is missing; the user closes it or moves on inside it.
 */
import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { closeTab, type TabScreens } from "@/navigation/tabs";

export function TabUnavailableNotice({ screens }: { screens: TabScreens }) {
  const { t } = useTranslation();
  const unavailable = useAppStore(
    (s) => s.documents.find((d) => d.id === s.activeDocumentId)?.unavailable ?? null,
  );
  const activeId = useAppStore((s) => s.activeDocumentId);
  if (!unavailable) return null;

  return (
    <div
      role="alert"
      data-tab-unavailable={unavailable}
      className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-list text-foreground"
    >
      <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1">
        {t(unavailable === "session" ? "common.tabs.unavailable.session" : "common.tabs.unavailable.project")}
      </p>
      <button
        type="button"
        onClick={() => void closeTab(activeId, screens)}
        className="shrink-0 rounded-md border border-border px-2 py-0.5 text-list hover:bg-muted"
      >
        {t("common.tabs.closeThis")}
      </button>
    </div>
  );
}
