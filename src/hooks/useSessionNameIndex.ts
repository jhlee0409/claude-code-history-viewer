/**
 * useSessionNameIndex
 *
 * Loads the session list of every given project so the sidebar filter can
 * match session names across projects, not only inside the open one.
 *
 * Only runs while `enabled` (the filter has a query and session matching is
 * on), so an unused filter costs nothing. Results are cached per project
 * version (path + last_modified) for the app's lifetime; the backend keeps
 * its own on-disk session cache, so even a cold sweep is mostly cache reads.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";

const FETCH_CONCURRENCY = 4;

const sessionListCache = new Map<string, ClaudeSession[]>();
/**
 * Project versions whose session list could not be read. Not retried until
 * the project changes (a new `last_modified` is a new key), so a broken
 * project is reported once instead of on every keystroke.
 */
const failedKeys = new Set<string>();

const cacheKey = (project: ClaudeProject, excludeSidechain: boolean) =>
  `${project.provider ?? "claude"}::${project.path}@${project.last_modified}::${excludeSidechain}`;

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

const buildFromCache = (projects: readonly ClaudeProject[], excludeSidechain: boolean) => {
  const map = new Map<string, ClaudeSession[]>();
  for (const project of projects) {
    const hit = sessionListCache.get(cacheKey(project, excludeSidechain));
    if (hit) map.set(project.path, hit);
  }
  return map;
};

const isDone = (key: string) => sessionListCache.has(key) || failedKeys.has(key);

export function useSessionNameIndex(
  projects: readonly ClaudeProject[],
  enabled: boolean
): SessionNameIndex {
  const { t } = useTranslation();
  const excludeSidechain = useAppStore((state) => state.excludeSidechain);
  const [sessionsByProject, setSessionsByProject] = useState<Map<string, ClaudeSession[]>>(
    () => new Map()
  );
  const [isIndexing, setIsIndexing] = useState(false);

  // Projects whose working directory is gone ("unavailable") still have
  // readable session files, so they are indexed too.
  const indexable = enabled ? projects : [];
  // A stable string key keeps the effect from re-running on every render of
  // an equal-but-new project array.
  const projectsKey = indexable.map((p) => cacheKey(p, excludeSidechain)).join("\n");

  useEffect(() => {
    if (!enabled) {
      setIsIndexing(false);
      return;
    }

    let cancelled = false;
    const targets = projects;
    setSessionsByProject(buildFromCache(targets, excludeSidechain));

    const pending = targets.filter((project) => !isDone(cacheKey(project, excludeSidechain)));
    if (pending.length === 0) {
      setIsIndexing(false);
      return;
    }

    setIsIndexing(true);
    void (async () => {
      let failed = 0;
      for (let i = 0; i < pending.length; i += FETCH_CONCURRENCY) {
        if (cancelled) return;
        const batch = pending.slice(i, i + FETCH_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((project) => loadProjectSessions(project, excludeSidechain))
        );
        if (cancelled) return;
        settled.forEach((outcome, idx) => {
          const project = batch[idx]!;
          const key = cacheKey(project, excludeSidechain);
          if (outcome.status === "fulfilled") {
            sessionListCache.set(key, Array.isArray(outcome.value) ? outcome.value : []);
          } else {
            // One unreadable project must not break the filter for the rest;
            // it can still match by its name.
            console.error(`Failed to index sessions for ${project.name}:`, outcome.reason);
            failedKeys.add(key);
            failed += 1;
          }
        });
        setSessionsByProject(buildFromCache(targets, excludeSidechain));
      }
      if (cancelled) return;
      setIsIndexing(false);
      if (failed > 0) {
        toast.error(t("project.filter.indexError", { count: failed }));
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
      ? indexable.filter(
          (p) => sessionsByProject.has(p.path) || failedKeys.has(cacheKey(p, excludeSidechain))
        ).length
      : 0,
    totalCount: indexable.length,
    isIndexing: enabled && isIndexing,
  };
}

/** Test-only: forget cached session lists and failures. */
export const clearSessionNameIndexCache = () => {
  sessionListCache.clear();
  failedKeys.clear();
};
