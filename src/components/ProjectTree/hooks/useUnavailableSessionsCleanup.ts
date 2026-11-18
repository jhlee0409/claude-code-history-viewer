import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClearedSession, UnavailableCleanupPreview } from "@/types";

export type CleanupPhase = "loading" | "preview" | "clearing" | "done" | "error";

export interface CleanupOutcome {
  /** One entry per confirmed session, in order; `error` null when trashed. */
  results: ClearedSession[];
  /**
   * The list refresh after the clear failed. Reported on its own: the
   * sessions in `results` were still moved (or not) as their entries say.
   */
  refreshFailed: boolean;
}

/**
 * Clearing the sessions of projects whose last-known location is missing
 * (#780). The backend resolves exactly what would go to the trash
 * (`preview_unavailable_session_cleanup`); confirming sends back only those
 * previewed sessions, which the backend re-validates one by one before
 * moving them (`clear_unavailable_sessions`).
 *
 * Mount it once per opened dialog: the preview loads on mount.
 */
export function useUnavailableSessionsCleanup(projects: readonly ClaudeProject[]) {
  const [phase, setPhase] = useState<CleanupPhase>("loading");
  const [previews, setPreviews] = useState<UnavailableCleanupPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CleanupOutcome | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<UnavailableCleanupPreview[]>("preview_unavailable_session_cleanup", {
      projects: projects.map((project) => ({
        provider: project.provider ?? null,
        path: project.path,
      })),
    }).then(
      (result) => {
        if (cancelled) return;
        setPreviews(result);
        setPhase("preview");
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const clear = useCallback(async () => {
    const confirmed = previews
      .filter((preview) => preview.excluded === null && preview.targets.length > 0)
      .map((preview) => ({
        provider: preview.provider,
        path: preview.project_path,
        session_paths: preview.targets.map((target) => target.session_path),
      }));
    if (confirmed.length === 0) return;

    setPhase("clearing");
    let results: ClearedSession[];
    try {
      results = await api<ClearedSession[]>("clear_unavailable_sessions", { projects: confirmed });
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
      return;
    }

    let refreshFailed = false;
    if (results.some((result) => result.error === null)) {
      try {
        const store = useAppStore.getState();
        await store.refreshAllConversations();
        // The project scan reports its own failure in `error` rather than
        // throwing; either way the clear itself is unaffected.
        refreshFailed = useAppStore.getState().error !== null;
      } catch {
        refreshFailed = true;
      }
    }
    if (!mounted.current) return;
    setOutcome({ results, refreshFailed });
    setPhase("done");
  }, [previews]);

  return { phase, previews, error, outcome, clear };
}
