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
/** The newest version asked for per project; older answers are dropped. */
const latestRequested = new Map<string, string>();
/** Reads in progress by `id@version`, shared by every effect run. */
const inFlight = new Map<string, Promise<void>>();

// One concurrency limit for every effect run: a run superseded by a watcher
// update keeps its reads going, so a per-run limit would stack up.
let activeFetches = 0;
const waitingForSlot: Array<() => void> = [];

async function withFetchSlot<T>(run: () => Promise<T>): Promise<T> {
  while (activeFetches >= FETCH_CONCURRENCY) {
    await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  }
  activeFetches += 1;
  try {
    return await run();
  } finally {
    activeFetches -= 1;
    waitingForSlot.shift()?.();
  }
}

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

/**
 * Reads `project`'s session list at `version` into the cache (or marks it
 * failed). Never rejects. A read already in progress for the same version is
 * reused, and one whose version was superseded before it started is skipped.
 */
const indexProject = (
  project: ClaudeProject,
  excludeSidechain: boolean,
  version: string
): Promise<void> => {
  const id = entryId(project, excludeSidechain);
  const key = `${id}@${version}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  latestRequested.set(id, version);
  const isCurrent = () => latestRequested.get(id) === version;
  const task = withFetchSlot(() =>
    isCurrent() ? loadProjectSessions(project, excludeSidechain) : Promise.resolve(null)
  )
    .then(
      (sessions) => {
        if (sessions === null || !isCurrent()) return;
        sessionListCache.set(id, { version, sessions: Array.isArray(sessions) ? sessions : [] });
        failedVersions.delete(id);
        reportedFailures.delete(id);
      },
      (reason: unknown) => {
        // One unreadable project must not break the filter for the rest;
        // it can still match by its name.
        console.error(`Failed to index sessions for ${project.name}:`, reason);
        if (isCurrent()) failedVersions.set(id, version);
      }
    )
    .finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
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

    // Failures are marked reported only once a toast actually said so: a run
    // cancelled before its toast leaves them to the next run.
    const reportFailures = () => {
      const unreported = targets.filter((project) => {
        const id = entryId(project, excludeSidechain);
        const version = versionOf(project, lastUpdateTime);
        return failedVersions.get(id) === version && reportedFailures.get(id) !== version;
      });
      if (unreported.length === 0) return;
      toast.error(t("project.filter.indexError", { count: unreported.length }));
      for (const project of unreported) {
        reportedFailures.set(entryId(project, excludeSidechain), versionOf(project, lastUpdateTime));
      }
    };

    const pending = targets.filter(
      (project) =>
        !isDone(entryId(project, excludeSidechain), versionOf(project, lastUpdateTime))
    );
    if (pending.length === 0) {
      setIsIndexing(false);
      reportFailures();
      return;
    }

    // Re-reading a project that already has a (older) list is a silent
    // refresh; only projects with nothing to match yet show progress.
    setIsIndexing(
      pending.some((project) => !sessionListCache.has(entryId(project, excludeSidechain)))
    );
    void (async () => {
      await Promise.all(
        pending.map((project) =>
          indexProject(project, excludeSidechain, versionOf(project, lastUpdateTime)).then(() => {
            if (!cancelled) setSessionsByProject(buildFromCache(targets, excludeSidechain));
          })
        )
      );
      if (cancelled) return;
      setIsIndexing(false);
      reportFailures();
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
  latestRequested.clear();
  inFlight.clear();
};
