/**
 * The session list of the project the ⌘K palette is scoped to with Tab
 * (plan T10): its Sessions group lists that project's sessions, not the
 * open project's.
 *
 * - The open project: the list the app already holds (no request).
 * - Any other project: its list is read once per scope (`loadSessionsFor`,
 *   the sidebar's provider-aware loader). The answer belongs to the
 *   project it was asked for: a scope change, closing the palette or
 *   unmounting drops it, success or failure (`owned`). Until it lands -
 *   and when it fails - the group lists what the app already knows of that
 *   project (its recent and starred sessions; `sessionCandidates`).
 */
import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { loadSessionsFor } from "@/lib/preloadSession";
import { isSameProject } from "@/commands/paletteSources";
import type { ClaudeProject, ClaudeSession } from "@/types";

const projectKey = (project: ClaudeProject): string => `${project.provider ?? "claude"}:${project.path}`;

/**
 * `project`'s sessions, or `[]` while they load (or failed). `openProject`
 * and `openSessions`: the project the app has open and its loaded list.
 */
export function useScopedProjectSessions(
  project: ClaudeProject | null,
  openProject: ClaudeProject | null,
  openSessions: readonly ClaudeSession[],
): readonly ClaudeSession[] {
  const isOpen = isSameProject(project, openProject);
  const key = project && !isOpen ? projectKey(project) : null;
  const [loaded, setLoaded] = useState<{ key: string; sessions: ClaudeSession[] } | null>(null);

  // Keyed on the project's identity: `project` is a new object only when
  // the list is rescanned, and a rescan of the same project needs no reload.
  useEffect(() => {
    if (!key || !project) return;
    let owned = true;
    const { excludeSidechain } = useAppStore.getState();
    loadSessionsFor(project, excludeSidechain).then(
      (sessions) => {
        if (owned) setLoaded({ key, sessions });
      },
      (error: unknown) => {
        if (!owned) return;
        // The group keeps the project's recent and starred sessions.
        console.error(`Palette: failed to load the sessions of ${project.path}:`, error);
        setLoaded({ key, sessions: [] });
      },
    );
    return () => {
      owned = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!project) return EMPTY;
  if (isOpen) return openSessions;
  return loaded?.key === key ? loaded.sessions : EMPTY;
}

const EMPTY: readonly ClaudeSession[] = [];
