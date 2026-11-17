/**
 * useSessionNameIndex
 *
 * Loads the session list of every given project so the sidebar filter can
 * match session names across projects, not only inside the open one.
 *
 * Only runs while `enabled` (the filter has a query and session matching is
 * on), so an unused filter costs nothing. One session list is cached per
 * project for the app's lifetime, tagged with the project version it was read
 * at (`last_modified` plus the file watcher's last update for that project).
 * When the version moves on, the old list keeps matching while the project is
 * re-read in the background; the backend keeps its own on-disk session cache,
 * so even a cold sweep is mostly cache reads.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";

const FETCH_CONCURRENCY = 4;

interface CachedSessionList {
  version: string;
  sessions: ClaudeSession[];
}

const sessionListCache = new Map<string, CachedSessionList>();
/**
 * Project versions whose session list could not be read during the current
 * search session. They count as done (no retry on every keystroke) and are
 * retried when a new search session starts or the project changes.
 */
const failedVersions = new Map<string, string>();
/** Project versions already reported in a toast, so a failure is told once. */
const reportedFailures = new Map<string, string>();

const entryId = (project: ClaudeProject, excludeSidechain: boolean) =>
  `${project.provider ?? "claude"}::${project.path}::${excludeSidechain}`;

const versionOf = (project: ClaudeProject, lastUpdateTime: Record<string, number>) =>
  `${project.last_modified}@${lastUpdateTime[project.path] ?? 0}`;

const loadProjectSessions = async (
  project: ClaudeProject,
  excludeSidechain: boolean
): Promise<ClaudeSession[]> => {
  const provider = project.provider ?? "claude";
  return provider !== "claude"
    ? api<ClaudeSession[]>("load_provider_sessions", {
        provider,
        projectPath: project.path,
        excludeSidechain,
      })
    : api<ClaudeSession[]>("load_project_sessions", {
        projectPath: project.path,
        excludeSidechain,
      });
};

export interface SessionNameIndex {
  /** Session lists keyed by project path, for projects loaded so far. */
  sessionsByProject: ReadonlyMap<string, readonly ClaudeSession[]>;
  /** Projects done so far (loaded or failed) / to do, for a progress hint. */
  loadedCount: number;
  totalCount: number;
  isIndexing: boolean;
}

/** Latest known session list per project, current or not yet refreshed. */
const buildFromCache = (projects: readonly ClaudeProject[], excludeSidechain: boolean) => {
  const map = new Map<string, ClaudeSession[]>();
  for (const project of projects) {
    const hit = sessionListCache.get(entryId(project, excludeSidechain));
    if (hit) map.set(project.path, hit.sessions);
  }
  return map;
};

const isDone = (id: string, version: string) =>
  sessionListCache.get(id)?.version === version || failedVersions.get(id) === version;

export function useSessionNameIndex(
  projects: readonly ClaudeProject[],
  enabled: boolean
): SessionNameIndex {
  const { t } = useTranslation();
  const excludeSidechain = useAppStore((state) => state.excludeSidechain);
  // Projects whose working directory is gone ("unavailable") still have
  // readable session files, so they are indexed too. A stable string key
  // keeps the effect from re-running on every render of an equal-but-new
  // project array; it only follows watcher updates while enabled.
  const projectsKey = useAppStore((state) =>
    enabled
      ? projects
          .map((p) => `${entryId(p, excludeSidechain)}@${versionOf(p, state.lastUpdateTime)}`)
          .join("\n")
      : ""
  );
  const [sessionsByProject, setSessionsByProject] = useState<Map<string, ClaudeSession[]>>(
    () => new Map()
  );
  const [isIndexing, setIsIndexing] = useState(false);
  const wasEnabled = useRef(false);

  useEffect(() => {
    if (!enabled) {
      wasEnabled.current = false;
      setIsIndexing(false);
      return;
    }
    // A new search session gives projects that failed last time another try.
    if (!wasEnabled.current) {
      wasEnabled.current = true;
      failedVersions.clear();
    }

    let cancelled = false;
    const targets = projects;
    const { lastUpdateTime } = useAppStore.getState();
    setSessionsByProject(buildFromCache(targets, excludeSidechain));

    const pending = targets.filter(
      (project) =>
        !isDone(entryId(project, excludeSidechain), versionOf(project, lastUpdateTime))
    );
    if (pending.length === 0) {
      setIsIndexing(false);
      return;
    }

    // Re-reading a project that already has a (older) list is a silent
    // refresh; only projects with nothing to match yet show progress.
    setIsIndexing(
      pending.some((project) => !sessionListCache.has(entryId(project, excludeSidechain)))
    );
    void (async () => {
      let newlyFailed = 0;
      for (let i = 0; i < pending.length; i += FETCH_CONCURRENCY) {
        if (cancelled) return;
        const batch = pending.slice(i, i + FETCH_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((project) => loadProjectSessions(project, excludeSidechain))
        );
        if (cancelled) return;
        settled.forEach((outcome, idx) => {
          const project = batch[idx]!;
          const id = entryId(project, excludeSidechain);
          const version = versionOf(project, lastUpdateTime);
          if (outcome.status === "fulfilled") {
            sessionListCache.set(id, {
              version,
              sessions: Array.isArray(outcome.value) ? outcome.value : [],
            });
            failedVersions.delete(id);
            reportedFailures.delete(id);
          } else {
            // One unreadable project must not break the filter for the rest;
            // it can still match by its name.
            console.error(`Failed to index sessions for ${project.name}:`, outcome.reason);
            failedVersions.set(id, version);
            if (reportedFailures.get(id) !== version) {
              reportedFailures.set(id, version);
              newlyFailed += 1;
            }
          }
        });
        setSessionsByProject(buildFromCache(targets, excludeSidechain));
      }
      if (cancelled) return;
      setIsIndexing(false);
      if (newlyFailed > 0) {
        toast.error(t("project.filter.indexError", { count: newlyFailed }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // projectsKey captures the identity of `projects` that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectsKey, excludeSidechain]);

  return {
    sessionsByProject,
    loadedCount: enabled
      ? projects.filter(
          (p) => sessionsByProject.has(p.path) || failedVersions.has(entryId(p, excludeSidechain))
        ).length
      : 0,
    totalCount: enabled ? projects.length : 0,
    isIndexing: enabled && isIndexing,
  };
}

/** Test-only: forget cached session lists and failures. */
export const clearSessionNameIndexCache = () => {
  sessionListCache.clear();
  failedVersions.clear();
  reportedFailures.clear();
};
