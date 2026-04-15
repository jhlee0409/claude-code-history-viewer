/**
 * CLI-driven session preload.
 *
 * When the desktop app is launched with `--session <uuid>`, the Rust side
 * stashes a {@link SessionHint} that the frontend retrieves via the
 * `get_startup_session_hint` command. This module resolves that hint against
 * the loaded project list and calls the existing `selectProject` /
 * `selectSession` actions — the same flow the GlobalSearch modal uses for
 * cross-project navigation.
 *
 * Commit A handles `kind: "uuid"` only. Commit B will extend this to path,
 * name, and sesslog folder hints.
 */

import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";

export interface SessionHint {
  kind: "uuid";
  value: string;
}

/** Translator function compatible with `i18next`'s `t()`. */
export type Translator = (key: string, fallback?: string) => string;

export interface PreloadDependencies {
  /** Retrieves the startup hint, if any. Injected for testability. */
  getStartupSessionHint: () => Promise<SessionHint | null>;
  /** List of known projects — usually from the app store after initial load. */
  projects: ClaudeProject[];
  /** Select a project (mirrors store action). */
  selectProject: (project: ClaudeProject) => Promise<void>;
  /** Select a session (mirrors store action). */
  selectSession: (session: ClaudeSession) => Promise<void>;
  /** i18n translator for the not-found toast. */
  t: Translator;
}

/**
 * Default implementation of {@link PreloadDependencies.getStartupSessionHint}
 * that calls the Tauri / WebUI backend.
 */
export async function fetchStartupSessionHint(): Promise<SessionHint | null> {
  try {
    return await api<SessionHint | null>("get_startup_session_hint");
  } catch (error) {
    // Command not registered (e.g. older backend) — treat as absent.
    console.warn("get_startup_session_hint unavailable:", error);
    return null;
  }
}

/**
 * Find a session matching a UUID or UUID-prefix across the given project's
 * loaded sessions.
 */
function matchSession(
  sessions: ClaudeSession[],
  uuidOrPrefix: string,
): ClaudeSession | undefined {
  const lower = uuidOrPrefix.toLowerCase();
  return sessions.find((s) => {
    const actual = s.actual_session_id?.toLowerCase() ?? "";
    const id = s.session_id?.toLowerCase() ?? "";
    return actual === lower || id === lower || actual.startsWith(lower) || id.startsWith(lower);
  });
}

/**
 * Resolve a UUID hint by scanning every known project's session list.
 *
 * Each non-claude provider gets its own `load_provider_sessions` call; the
 * default claude provider uses `load_project_sessions`. Mirrors the scan in
 * `GlobalSearchModal.handleSelectResult`.
 */
async function findSessionAcrossProjects(
  uuid: string,
  projects: ClaudeProject[],
): Promise<{ project: ClaudeProject; session: ClaudeSession } | null> {
  for (const project of projects) {
    try {
      const providerId = project.provider ?? "claude";
      const { excludeSidechain } = useAppStore.getState();
      const projectSessions = await api<ClaudeSession[]>(
        providerId !== "claude" ? "load_provider_sessions" : "load_project_sessions",
        providerId !== "claude"
          ? { provider: providerId, projectPath: project.path, excludeSidechain }
          : { projectPath: project.path, excludeSidechain },
      );
      const session = matchSession(projectSessions, uuid);
      if (session) {
        return { project, session };
      }
    } catch (error) {
      console.warn(`preloadSession: failed to scan project ${project.name}:`, error);
    }
  }
  return null;
}

/**
 * Main entry point. Called once after projects are loaded. If no hint is
 * present, returns a benign `{ handled: false }`. If a hint is present but
 * no session matches, shows a toast and returns `{ handled: true,
 * matched: false }`.
 */
export async function preloadSessionFromCli(
  deps: PreloadDependencies,
): Promise<{ handled: boolean; matched: boolean }> {
  const hint = await deps.getStartupSessionHint();
  if (!hint) {
    return { handled: false, matched: false };
  }
  if (hint.kind !== "uuid") {
    // Commit A: unrecognized kinds are ignored rather than crashing.
    console.warn(`preloadSession: unsupported hint kind "${hint.kind}"`);
    return { handled: true, matched: false };
  }

  const match = await findSessionAcrossProjects(hint.value, deps.projects);
  if (!match) {
    toast.error(deps.t("globalSearch.sessionNotFound", "Session not found"));
    return { handled: true, matched: false };
  }

  await deps.selectProject(match.project);
  await deps.selectSession(match.session);
  return { handled: true, matched: true };
}
