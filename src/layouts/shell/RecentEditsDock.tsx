/**
 * The recent-edits dock: the docked shape of the recent-edits page, beside a
 * transcript in the inspector slot.
 *
 * Gated at xl (1280px), not md. The sidebar (256) plus the navigator (280)
 * plus this dock (340) is 876px of fixed chrome: at md (768) that leaves the
 * transcript nothing at all. 1280 leaves it ~404px, which is the narrowest
 * width this layout was actually reviewed at.
 */
import { useTranslation } from "react-i18next";
import { FileEdit } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { PanelDock } from "@/components/PanelDock";
import { RecentEditsPanel } from "@/components/RecentEditsViewer/RecentEditsPanel";
import { RecentEditsViewToggle } from "@/components/RecentEditsViewer/RecentEditsViewToggle";

interface RecentEditsDockProps {
  width: number;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent<HTMLElement>) => void;
}

export const RecentEditsDock = ({ width, isResizing, onResizeStart }: RecentEditsDockProps) => {
  const { t } = useTranslation();
  const stats = useAppStore((s) => s.recentEditsDock);
  const setRecentEditsMode = useAppStore((s) => s.setRecentEditsMode);
  const setRecentEditsDockOpen = useAppStore((s) => s.setRecentEditsDockOpen);
  const navigate = useAppStore((s) => s.navigate);

  /*
    The return trip out of the dock. Mode is only a preference; what actually
    decides what renders is the place's `view`, so without the third call
    the panel would simply vanish and leave the user on the transcript, which is
    not what choosing "Page" promises.
  */
  const undock = () => {
    setRecentEditsMode("page");
    setRecentEditsDockOpen(false);
    void navigate({ view: "edits" });
  };

  return (
    <div className="hidden xl:block">
      <PanelDock
        asideId="recent-edits-dock"
        isResizing={isResizing}
        onResizeStart={(_group, event) => onResizeStart(event)}
        groups={[
          {
            tabs: ["recentEdits"],
            activeTab: "recentEdits",
            size: width,
          },
        ]}
        panels={{
          recentEdits: {
            id: "recentEdits",
            title: t("recentEdits.title"),
            /*
              The same mark the full page uses, scaled to a panel header.
              Without it the dock read as anonymous text where every other
              surface in the app leads with an icon in a tinted tile.
            */
            icon: (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/20">
                <FileEdit className="h-4 w-4 text-accent" aria-hidden="true" />
              </span>
            ),
            /*
              The same summary the full page shows, from the same counts, so
              switching between the two shapes does not change what the header
              tells you. Omitted until a result arrives rather than rendered as
              zeroes, which would read as "this project has no edits".
            */
            subtitle: stats
              ? t("recentEdits.stats", {
                  files: stats.uniqueFilesCount,
                  edits: stats.totalEditsCount,
                })
              : undefined,
            headerAction: (
              <RecentEditsViewToggle
                value="sidebar"
                onChange={(next) => next === "page" && undock()}
              />
            ),
            render: () => <RecentEditsPanel />,
          },
        }}
      />
    </div>
  );
};
