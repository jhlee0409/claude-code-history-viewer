// src/components/ProjectTree/components/LibrarySection.tsx
import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, CircleQuestionMark, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeSession } from "@/types";
import { favoritesOf, type FavoriteEntry, type RecentEntry } from "@/navigation/library";
import { openLegacyFavorite, openSessionRef } from "@/navigation/openSessionRef";
import type { LibraryItem } from "@/navigation/place";
import { formatTimeAgo } from "@/utils/time";

export interface LibrarySectionProps {
  /** The library row the open screen is (plan C3), or null. */
  activeItem: LibraryItem | null;
  onGlobalStatsClick: () => void;
  onOpenArchive?: () => void;
  /** The archive is Claude Code's; another provider's project disables it. */
  isArchiveDisabled?: boolean;
  onOpenSettingsManager?: () => void;
  /** Called after any row opened something (closes the mobile drawer). */
  onNavigate?: () => void;
}

/**
 * The sidebar's library (plan T7, decision page §1 and (다)): recently opened
 * sessions, favourites, then the app-level screens - global statistics, the
 * archive and the Claude Code settings editor. Recent and Favourites expand in
 * place; the screen rows open their screen and show it as current.
 */
export const LibrarySection: React.FC<LibrarySectionProps> = ({
  activeItem,
  onGlobalStatsClick,
  onOpenArchive,
  isArchiveDisabled = false,
  onOpenSettingsManager,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const headingId = useId();
  const recent = useAppStore((s) => s.recentSessions);
  const userMetadata = useAppStore((s) => s.userMetadata);
  const loadedSessions = useAppStore((s) => s.sessions);
  const favorites = favoritesOf(userMetadata);
  const [open, setOpen] = useState<{ recent: boolean; favorites: boolean }>({ recent: false, favorites: false });

  const openEntry = (run: () => Promise<unknown>) => {
    onNavigate?.();
    run().catch((error: unknown) => {
      console.error("Failed to open a library entry:", error);
      toast.error(t("session.openError"));
    });
  };

  return (
    <nav aria-labelledby={headingId} className="px-2 pt-1.5 pb-1">
      <h2 id={headingId} className="px-2 pb-1 text-caption font-medium text-muted-foreground">
        {t("project.library.title")}
      </h2>
      <ul>
        <li>
          <DisclosureRow
            icon={SCREEN_ICONS.recent}
            label={t("project.library.recent")}
            count={recent.length}
            expanded={open.recent}
            onToggle={() => setOpen((o) => ({ ...o, recent: !o.recent }))}
            dataItem="recent"
          />
          {open.recent && (
            <EntryList
              emptyLabel={t("project.library.recentEmpty")}
              entries={recent.map((entry) => ({
                key: entry.ref.filePath,
                sessionId: entry.ref.sessionId,
                title: entry.title,
                caption: formatTimeAgo(new Date(entry.openedAt).toISOString()),
                open: () => openEntry(() => openSessionRef(entry.ref)),
              }))}
            />
          )}
        </li>
        <li>
          <DisclosureRow
            icon={SCREEN_ICONS.favorites}
            label={t("project.library.favorites")}
            count={favorites.length}
            expanded={open.favorites}
            onToggle={() => setOpen((o) => ({ ...o, favorites: !o.favorites }))}
            dataItem="favorites"
          />
          {open.favorites && (
            <EntryList
              emptyLabel={t("project.library.favoritesEmpty")}
              entries={favorites.map((favorite) =>
                favoriteEntry(favorite, { recent, loadedSessions }, openEntry, t)
              )}
            />
          )}
        </li>
        <li>
          <ScreenRow
            icon={SCREEN_ICONS.globalStats}
            label={t("project.globalStats")}
            active={activeItem === "globalStats"}
            onClick={() => {
              onGlobalStatsClick();
              onNavigate?.();
            }}
            dataItem="globalStats"
            // The capture harness and older selectors find the row by this.
            treeNode="global"
          />
        </li>
        {onOpenArchive && (
          <li>
            <ScreenRow
              icon={SCREEN_ICONS.archive}
              label={
                isArchiveDisabled
                  ? t("common.settings.claudeOnly", { name: t("project.library.archive") })
                  : t("project.library.archive")
              }
              active={activeItem === "archive"}
              disabled={isArchiveDisabled}
              onClick={() => {
                onOpenArchive();
                onNavigate?.();
              }}
              dataItem="archive"
            />
          </li>
        )}
        {onOpenSettingsManager && (
          <li>
            <ScreenRow
              icon={SCREEN_ICONS.settings}
              label={t("project.library.claudeSettings")}
              active={activeItem === "settingsManager"}
              onClick={() => {
                onOpenSettingsManager();
                onNavigate?.();
              }}
              dataItem="settingsManager"
            />
          </li>
        )}
      </ul>
    </nav>
  );
};

interface Entry {
  key: string;
  sessionId: string;
  title: string;
  caption: string;
  /** Shown instead of the caption, as a warning (a legacy favourite). */
  warning?: string;
  open: () => void;
}

/**
 * A favourite as a library entry; one without a ref is found by its id.
 * Metadata keeps no title, so the name comes from the custom name, the open
 * project's sessions or the recent list, else a short id ("Session 1a2b3c4d").
 */
function favoriteEntry(
  favorite: FavoriteEntry,
  known: { recent: readonly RecentEntry[]; loadedSessions: readonly ClaudeSession[] },
  openEntry: (run: () => Promise<unknown>) => void,
  t: (key: string) => string
): Entry {
  const loaded = known.loadedSessions.find((s) => s.session_id === favorite.sessionId);
  const seen = known.recent.find((r) => r.ref.sessionId === favorite.sessionId);
  const shortId = (favorite.ref?.actualSessionId ?? favorite.sessionId)
    .replace(/\.jsonl$/, "")
    .slice(-8);
  const title =
    favorite.customName ?? loaded?.summary ?? seen?.title ?? `${t("session.title")} ${shortId}`;
  if (!favorite.ref) {
    return {
      key: `legacy:${favorite.sessionId}`,
      sessionId: favorite.sessionId,
      title,
      caption: "",
      warning: t("project.library.locationUnknown"),
      open: () => openEntry(() => openLegacyFavorite(favorite.sessionId)),
    };
  }
  const ref = favorite.ref;
  return {
    key: ref.filePath,
    sessionId: favorite.sessionId,
    title,
    caption: "",
    open: () => openEntry(() => openSessionRef(ref)),
  };
}

const rowClass = (active: boolean) =>
  cn(
    "w-full h-7 flex items-center gap-2 px-2 rounded-md text-left text-list outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-accent",
    active ? "bg-accent/15 text-foreground font-medium" : "text-sidebar-foreground/85 hover:bg-muted/60"
  );

const RowIcon = ({ icon: Glyph, active }: { icon: LucideIcon; active: boolean }) => (
  // Selected: the icon takes the accent (decision page §7).
  <Glyph className={cn("w-4 h-4 shrink-0", active ? "text-accent" : "text-muted-foreground")} aria-hidden="true" />
);

const DisclosureRow = ({
  icon,
  label,
  count,
  expanded,
  onToggle,
  dataItem,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  dataItem: string;
}) => (
  <button
    type="button"
    aria-expanded={expanded}
    data-library-item={dataItem}
    onClick={onToggle}
    className={cn(rowClass(false), "group/disclosure")}
  >
    <RowIcon icon={icon} active={false} />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{count}</span>
    {expanded ? (
      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : (
      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    )}
  </button>
);

const ScreenRow = ({
  icon,
  label,
  active,
  disabled = false,
  onClick,
  dataItem,
  treeNode,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  dataItem: string;
  treeNode?: string;
}) => (
  <button
    type="button"
    aria-current={active ? "page" : undefined}
    data-library-item={dataItem}
    data-tree-node={treeNode}
    disabled={disabled}
    onClick={onClick}
    title={label}
    className={cn(rowClass(active), disabled && "opacity-50 cursor-not-allowed")}
  >
    <RowIcon icon={icon} active={active} />
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const EntryList = ({ entries, emptyLabel }: { entries: Entry[]; emptyLabel: string }) => {
  const getSessionDisplayName = useAppStore((s) => s.getSessionDisplayName);
  if (entries.length === 0) {
    return <p className="h-7 flex items-center pl-8 pr-2 text-caption text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul>
      {entries.map((entry) => {
        const name = getSessionDisplayName(entry.sessionId, entry.title) || entry.title;
        return (
          <li key={entry.key}>
            <button
              type="button"
              data-library-entry
              onClick={entry.open}
              title={entry.warning ? `${name}\n${entry.warning}` : name}
              className={cn(rowClass(false), "pl-8")}
            >
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {entry.warning ? (
                <span className="flex shrink-0 items-center gap-1 text-caption text-warning">
                  <CircleQuestionMark className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{entry.warning}</span>
                </span>
              ) : (
                entry.caption && (
                  <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{entry.caption}</span>
                )
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
