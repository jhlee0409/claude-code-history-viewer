// src/components/ProjectTree/components/ProjectSessions.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadingRows } from "@/components/ui/loading-rows";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { SessionItem } from "../../SessionItem";
import { SESSION_CONTROLS_MIN, SessionList } from "./SessionList";
import type { ClaudeProject, ClaudeSession } from "../../../types";
import type { SessionSelectHandler } from "../types";

/** Sessions an expanded project shows before "Show all" (plan T7). */
export const SESSION_PREVIEW_COUNT = 5;

const byNewest = (a: ClaudeSession, b: ClaudeSession) =>
  new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime();

interface SessionPage {
  sessions: ClaudeSession[];
  total: number;
}

/**
 * The newest sessions of a project that is expanded but not open (plan §9b
 * F3: expanding is not selecting, so the store's list - the open project's -
 * does not apply). Local state only: one small page, dropped when a newer
 * request for the row starts or the row collapses.
 */
function useSessionPreview(project: ClaudeProject, enabled: boolean): {
  page: SessionPage | null;
  failed: boolean;
} {
  const excludeSidechain = useAppStore((s) => s.excludeSidechain);
  const [state, setState] = useState<{ key: string; page: SessionPage | null; failed: boolean }>({
    key: "",
    page: null,
    failed: false,
  });
  const key = `${project.provider ?? "claude"}:${project.path}:${excludeSidechain}`;

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api<SessionPage>("load_provider_sessions_page", {
      provider: project.provider ?? "claude",
      projectPath: project.path,
      excludeSidechain,
      offset: 0,
      limit: SESSION_PREVIEW_COUNT,
    })
      .then((page) => {
        if (current) setState({ key, page, failed: false });
      })
      .catch((error: unknown) => {
        console.error("Failed to load the session preview:", error);
        if (current) setState({ key, page: null, failed: true });
      });
    return () => {
      current = false;
    };
  }, [enabled, key, project.path, project.provider, excludeSidechain]);

  return state.key === key ? { page: state.page, failed: state.failed } : { page: null, failed: false };
}

interface ProjectSessionsProps {
  project: ClaudeProject;
  /** This is the open project: its sessions are the store's list. */
  isOpen: boolean;
  /** The store's list (the open project's). */
  sessions: ClaudeSession[];
  sessionsTotal: number;
  hasMoreSessions: boolean;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingMoreSessions: boolean;
  /** "Show all" was asked for on this project. */
  showAll: boolean;
  onShowAll: (project: ClaudeProject, showAll: boolean) => void;
  /** Called with this row's `project` as the session's owner. */
  onSessionSelect: SessionSelectHandler;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions: () => void;
  formatTimeAgo: (date: string) => string;
}

/**
 * What an expanded project row lists under it (plan T7, decision (나)):
 * its newest five sessions and "Show all · N". "Show all", the selection
 * mode and the open project's search/sort/source controls use the full list
 * (`SessionList`), which belongs to the open project. The open project
 * offers "Show all" whenever the list has those controls, even when the
 * preview already shows every session: it is their only route outside the
 * selection mode.
 *
 * When the sidebar filter shows this project only because some of its
 * sessions matched by name, both the preview and the full list hold just
 * those sessions.
 */
export const ProjectSessions: React.FC<ProjectSessionsProps> = ({
  project,
  isOpen,
  sessions,
  sessionsTotal,
  hasMoreSessions,
  selectedSession,
  isLoading,
  isLoadingMoreSessions,
  showAll,
  onShowAll,
  onSessionSelect,
  onSessionHover,
  onLoadMoreSessions,
  formatTimeAgo,
}) => {
  const { t } = useTranslation();
  const isSelectionMode = useAppStore((s) => s.isSessionSelectionMode);
  const enterSessionSelectionMode = useAppStore((s) => s.enterSessionSelectionMode);
  const handleSessionSelectionClick = useAppStore((s) => s.handleSessionSelectionClick);
  const filterMatches = useAppStore(
    (s) => s.sidebarFilterResult?.sessionMatchesByProject[project.path]
  );
  // The matches come from a full session list, so paging is moot. The open
  // project's own copy of a session is preferred: the file watcher keeps it
  // fresh.
  const matched = useMemo(() => {
    if (!filterMatches) return null;
    const loadedById = new Map(
      (isOpen ? sessions : []).map((session) => [session.session_id, session])
    );
    return filterMatches
      .map((session) => loadedById.get(session.session_id) ?? session)
      .sort(byNewest);
  }, [filterMatches, isOpen, sessions]);
  const preview = useSessionPreview(project, !isOpen && !matched);

  const listed = matched ?? sessions;
  const newest = useMemo(
    () => [...listed].sort(byNewest).slice(0, SESSION_PREVIEW_COUNT),
    [listed]
  );

  const matchesHint = matched ? (
    <div role="status" className="h-6 flex items-center pl-8 pr-2 text-caption text-muted-foreground">
      <span className="truncate">{t("project.sessions.filterMatches", { count: matched.length })}</span>
    </div>
  ) : null;

  if (isOpen && (showAll || isSelectionMode)) {
    return (
      <div role="group">
        {matchesHint}
        <SessionList
          sessions={listed}
          sessionsTotal={matched ? matched.length : sessionsTotal}
          hasMoreSessions={matched ? false : hasMoreSessions}
          selectedSession={selectedSession}
          isLoading={matched ? false : isLoading}
          isLoadingMoreSessions={isLoadingMoreSessions}
          onSessionSelect={(session) => onSessionSelect(session, project)}
          onSessionHover={onSessionHover}
          onLoadMoreSessions={onLoadMoreSessions}
          formatTimeAgo={formatTimeAgo}
          density="compact"
        />
        {showAll && !isSelectionMode && (
          <ShowMoreRow label={t("project.sessions.showFewer")} onClick={() => onShowAll(project, false)} />
        )}
      </div>
    );
  }

  const rows = isOpen || matched ? newest : (preview.page?.sessions ?? []);
  const total = matched
    ? matched.length
    : isOpen
      ? sessionsTotal
      : (preview.page?.total ?? project.session_count);
  const loading = matched
    ? false
    : isOpen
      ? isLoading && sessions.length === 0
      : preview.page === null && !preview.failed;

  if (loading) {
    return <LoadingRows label={t("common.loadingSessions")} compact className="pl-7 py-2" />;
  }

  if (rows.length === 0) {
    return (
      <div role="group" className="h-7 flex items-center pl-7 text-caption text-muted-foreground">
        {preview.failed ? t("project.sessions.loadError") : t("project.sessions.empty")}
      </div>
    );
  }

  // A Shift+click in the open project's preview starts a selection over its
  // full list (the preview is part of it). Elsewhere it opens the session.
  const orderedIds = listed.map((s) => s.session_id);
  const startSelection = (session: ClaudeSession) => {
    enterSessionSelectionMode();
    if (selectedSession && selectedSession.session_id !== session.session_id && orderedIds.includes(selectedSession.session_id)) {
      handleSessionSelectionClick(selectedSession.session_id, orderedIds, { shift: false, cmdOrCtrl: false });
    }
    handleSessionSelectionClick(session.session_id, orderedIds, { shift: true, cmdOrCtrl: false });
  };

  return (
    <div role="group">
      {matchesHint}
      {rows.map((session) => (
        <SessionItem
          key={session.file_path}
          session={session}
          project={project}
          variant="compact"
          isSelected={selectedSession?.file_path === session.file_path}
          onSelect={() => onSessionSelect(session, project)}
          onHover={() => onSessionHover?.(session)}
          formatTimeAgo={formatTimeAgo}
          onModifierSelect={() => (isOpen ? startSelection(session) : onSessionSelect(session, project))}
        />
      ))}
      {(total > rows.length || (isOpen && total >= SESSION_CONTROLS_MIN)) && (
        <ShowMoreRow
          label={t("project.sessions.showAll", { count: total })}
          onClick={() => onShowAll(project, true)}
        />
      )}
    </div>
  );
};

/** "Show all · N" / "Show fewer": a tree item, so arrow keys reach it. */
const ShowMoreRow = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    role="treeitem"
    aria-level={2}
    aria-selected={false}
    data-tree-node="show-all"
    tabIndex={-1}
    onClick={onClick}
    className={cn(
      "w-full h-7 flex items-center pl-7 pr-2 rounded-md text-left text-list text-accent",
      "hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    )}
  >
    {label}
  </button>
);
