/**
 * The session list of the project the ⌘K palette is scoped to with Tab
 * (plan T10): its Sessions group lists that project's sessions, not the
 * open project's.
 *
 * - The open project: the list the app already holds (no request).
 * - Any other project: its list is read once per scope (`loadSessionsFor`,
 *   the sidebar's provider-aware loader), and again on `retry`. The answer
 *   belongs to the request it answers: a scope change, a retry, closing the
 *   palette or unmounting drops it, success or failure (`owned`). Until it
 *   lands - and when it fails - the group lists what the app already knows
 *   of that project (its recent and starred sessions; `sessionCandidates`).
 * - A failed list is `failed`, not an empty one: the Sessions group says it
 *   is incomplete and offers `retry`. Only the current scope's latest
 *   request can fail it, so a failure the palette has moved on from never
 *   shows.
 */
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { loadSessionsFor } from "@/lib/preloadSession";
import { isSameProject } from "@/commands/paletteSources";
import type { ClaudeProject, ClaudeSession } from "@/types";

const projectKey = (project: ClaudeProject): string => `${project.provider ?? "claude"}:${project.path}`;

export interface ScopedProjectSessions {
  /** `project`'s sessions; `[]` while they load, or when they failed. */
  sessions: readonly ClaudeSession[];
  /** The current scope's latest request failed. */
  failed: boolean;
  /** Ask for the list again (after a failure). */
  retry: () => void;
}

/** One request's answer: its project, its request number, and the list or failure. */
type Answer = { key: string; attempt: number } & ({ sessions: ClaudeSession[] } | { failed: true });

/**
 * `project`'s sessions. `openProject` and `openSessions`: the project the
 * app has open and its loaded list.
 */
export function useScopedProjectSessions(
  project: ClaudeProject | null,
  openProject: ClaudeProject | null,
  openSessions: readonly ClaudeSession[],
): ScopedProjectSessions {
  const isOpen = isSameProject(project, openProject);
  const key = project && !isOpen ? projectKey(project) : null;
  // The current request: a new one for every scope and every retry, so an
  // answer - a failure above all - is only ever the request's it answers.
  const [request, setRequest] = useState({ key, attempt: 0 });
  if (request.key !== key) setRequest({ key, attempt: request.attempt + 1 });
  const attempt = request.attempt;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const retry = useCallback(() => setRequest((r) => ({ key: r.key, attempt: r.attempt + 1 })), []);

  // Keyed on the project's identity: `project` is a new object only when
  // the list is rescanned, and a rescan of the same project needs no reload.
  useEffect(() => {
    if (!key || !project) return;
    let owned = true;
    const { excludeSidechain } = useAppStore.getState();
    loadSessionsFor(project, excludeSidechain).then(
      (sessions) => {
        if (owned) setAnswer({ key, attempt, sessions });
      },
      (error: unknown) => {
        if (!owned) return;
        console.error(`Palette: failed to load the sessions of ${project.path}:`, error);
        setAnswer({ key, attempt, failed: true });
      },
    );
    return () => {
      owned = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  if (!project) return { sessions: EMPTY, failed: false, retry };
  if (isOpen) return { sessions: openSessions, failed: false, retry };
  // Another project's answer, or an earlier request's, is not this one.
  const current = answer?.key === key && answer.attempt === attempt ? answer : null;
  if (!current) return { sessions: EMPTY, failed: false, retry };
  return "failed" in current
    ? { sessions: EMPTY, failed: true, retry }
    : { sessions: current.sessions, failed: false, retry };
}

const EMPTY: readonly ClaudeSession[] = [];
