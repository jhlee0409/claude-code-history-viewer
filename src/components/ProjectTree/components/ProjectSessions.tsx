// src/components/ProjectTree/components/ProjectSessions.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { SessionItem } from "../../SessionItem";
import { SESSION_CONTROLS_MIN, SessionList } from "./SessionList";
import type { ClaudeProject, ClaudeSession } from "../../../types";

/** Sessions an expanded project shows before "Show all" (plan T7). */
export const SESSION_PREVIEW_COUNT = 5;

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
  onSessionSelect: (session: ClaudeSession) => void;
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
  const preview = useSessionPreview(project, !isOpen);

  const newest = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime())
        .slice(0, SESSION_PREVIEW_COUNT),
    [sessions]
  );

  if (isOpen && (showAll || isSelectionMode)) {
    return (
      <div role="group">
        <SessionList
          sessions={sessions}
          sessionsTotal={sessionsTotal}
          hasMoreSessions={hasMoreSessions}
          selectedSession={selectedSession}
          isLoading={isLoading}
          isLoadingMoreSessions={isLoadingMoreSessions}
          onSessionSelect={onSessionSelect}
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

  const rows = isOpen ? newest : (preview.page?.sessions ?? []);
  const total = isOpen ? sessionsTotal : (preview.page?.total ?? project.session_count);
  const loading = isOpen ? isLoading && sessions.length === 0 : preview.page === null && !preview.failed;

  if (loading) {
    return (
      <div role="group" className="h-7 flex items-center gap-1.5 pl-7 text-caption text-muted-foreground">
        <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        {t("common.loading")}
      </div>
    );
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
  const orderedIds = sessions.map((s) => s.session_id);
  const startSelection = (session: ClaudeSession) => {
    enterSessionSelectionMode();
    if (selectedSession && selectedSession.session_id !== session.session_id && orderedIds.includes(selectedSession.session_id)) {
      handleSessionSelectionClick(selectedSession.session_id, orderedIds, { shift: false, cmdOrCtrl: false });
    }
    handleSessionSelectionClick(session.session_id, orderedIds, { shift: true, cmdOrCtrl: false });
  };

  return (
    <div role="group">
      {rows.map((session) => (
        <SessionItem
          key={session.file_path}
          session={session}
          project={project}
          variant="compact"
          isSelected={selectedSession?.file_path === session.file_path}
          onSelect={() => onSessionSelect(session)}
          onHover={() => onSessionHover?.(session)}
          formatTimeAgo={formatTimeAgo}
          onModifierSelect={() => (isOpen ? startSelection(session) : onSessionSelect(session))}
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
