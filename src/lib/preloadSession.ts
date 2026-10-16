/**
 * CLI-driven session preload.
 *
 * When the desktop app is launched with `--session <uuid|path>`,
 * `--session-folder <name>`, or `--session-title <text>`, the Rust side
 * stashes a {@link SessionHint} that the frontend retrieves via the
 * `get_startup_session_hint` command. This module resolves that hint against
 * the loaded project list and opens the match through `openMatch` (the
 * store's `navigate`) — the same transaction the GlobalSearch modal uses for
 * cross-project navigation.
 *
 * Stage B resolvers:
 * - `uuid`   — UUID / UUID-prefix match, first hit wins (same as Stage A).
 * - `path`   — Absolute path to a `.jsonl` file; match by `file_path`.
 * - `folder` — Exact project folder name match. Then pick the most recent session.
 * - `title`  — Case-insensitive substring match against session titles / first
 *              message previews. Multi-match opens the session picker modal.
 */

import { toast } from "sonner";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { isWebUI } from "@/utils/platform";
import { readWebUIDeepLink } from "@/utils/webuiDeepLink";
import type { SessionPickerCandidate } from "@/store/slices/sessionPickerSlice";
import type { ClaudeProject, ClaudeSession } from "@/types";

export type SessionHintKind = "uuid" | "path" | "folder" | "title";

export interface SessionHint {
  kind: SessionHintKind;
  value: string;
}

/** Translator function compatible with `i18next`'s `t()`. */
export type Translator = (key: string, fallback?: string) => string;

// Re-exported so App.tsx can keep its existing import surface stable.
export type { SessionPickerCandidate };

export interface PreloadDependencies {
  /** Retrieves the startup hint, if any. Injected for testability. */
  getStartupSessionHint: () => Promise<SessionHint | null>;
  /** List of known projects — usually from the app store after initial load. */
  projects: ClaudeProject[];
  /**
   * Open the resolved match (project + session) as one navigation. Resolves
   * false when a newer navigation superseded it on the way.
   */
  openMatch: (match: SessionPickerCandidate) => Promise<boolean>;
  /** Open the session picker modal for ambiguous title matches. */
  openSessionPicker: (candidates: SessionPickerCandidate[], hintValue: string) => void;
  /** i18n translator for the not-found toast. */
  t: Translator;
  /**
   * Returns false when a newer navigation request superseded this preload.
   * Optional so callers that do not have concurrent navigation can use the
   * resolver without maintaining a request token.
   */
  isCurrent?: () => boolean;
}

/**
 * Default implementation of {@link PreloadDependencies.getStartupSessionHint}
 * that calls the Tauri / WebUI backend.
 */
export async function fetchStartupSessionHint(): Promise<SessionHint | null> {
  if (isWebUI()) {
    const { sessionId } = readWebUIDeepLink();
    return sessionId ? { kind: "uuid", value: sessionId } : null;
  }

  try {
    return await api<SessionHint | null>("get_startup_session_hint");
  } catch (error) {
    // Command not registered (e.g. older backend) — treat as absent.
    console.warn("get_startup_session_hint unavailable:", error);
    return null;
  }
}

// ============================================================================
// UUID matcher (Stage A)
// ============================================================================

function matchByUuid(
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

// ============================================================================
// Path matcher (Stage B)
// ============================================================================

/**
 * Normalize a path for cross-platform comparison: collapse `\\` → `/`, lowercase
 * for Windows path forms (filesystem is case-insensitive), and strip a trailing
 * slash.
 *
 * Windows absolute paths take two shapes: drive-letter (`C:\...` or `C:/...`
 * which becomes `C:/...` after backslash normalization) and UNC
 * (`\\server\share\...` which becomes `//server/share/...`). Both are
 * case-insensitive on NTFS; we lowercase both so CLI value and stored
 * `file_path` compare equal regardless of the user's casing.
 */
function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const isWindowsDriveLetter = /^[a-zA-Z]:\//.test(unified);
  const isWindowsUnc = unified.startsWith("//");
  if (isWindowsDriveLetter || isWindowsUnc) {
    return unified.toLowerCase();
  }
  return unified;
}

export function matchByPath(sessions: ClaudeSession[], absPath: string): ClaudeSession | undefined {
  const target = normalizePath(absPath);
  return sessions.find((s) => normalizePath(s.file_path ?? "") === target);
}

// ============================================================================
// Title matcher (Stage B)
// ============================================================================

/**
 * Build a searchable string for a session: its effective display name (user's
 * custom rename if any, else summary/first-message preview) plus the owning
 * project name. Lowercased for case-insensitive substring matching.
 */
function titleHaystack(s: ClaudeSession): string {
  // Metadata store keys custom names by `session_id` (the app-wide identifier
  // used by SessionItem, editor, etc). Querying by `actual_session_id` would
  // miss user renames and behave inconsistently with the rest of the UI.
  const display = useAppStore.getState().getSessionDisplayName(s.session_id, s.summary)
    ?? s.summary
    ?? "";
  return `${display} ${s.project_name ?? ""}`.toLowerCase();
}

function matchByTitle(sessions: ClaudeSession[], substring: string): ClaudeSession[] {
  const needle = substring.toLowerCase();
  return sessions.filter((s) => titleHaystack(s).includes(needle));
}

// ============================================================================
// Project scan helpers
// ============================================================================

type ProjectSessionsPair = { project: ClaudeProject; sessions: ClaudeSession[] };

export async function loadSessionsFor(
  project: ClaudeProject,
  excludeSidechain: boolean,
): Promise<ClaudeSession[]> {
  const providerId = project.provider ?? "claude";
  return api<ClaudeSession[]>(
    providerId !== "claude" ? "load_provider_sessions" : "load_project_sessions",
    providerId !== "claude"
      ? { provider: providerId, projectPath: project.path, excludeSidechain }
      : { projectPath: project.path, excludeSidechain },
  );
}

/**
 * Scan every known project and return sessions paired with their owning
 * project. Tolerates per-project failures (logs warn, keeps going). Aborts
 * early if the race guard trips (user manually picked a session).
 *
 * Returns `null` when the race guard fires so callers can distinguish "user
 * picked something" from "no matches."
 */
async function scanAllProjects(
  projects: ClaudeProject[],
  isCurrent: () => boolean,
): Promise<ProjectSessionsPair[] | null> {
  const { excludeSidechain } = useAppStore.getState();
  const out: ProjectSessionsPair[] = [];

  for (const project of projects) {
    if (!isCurrent()) {
      return null;
    }
    try {
      const sessions = await loadSessionsFor(project, excludeSidechain);
      if (!isCurrent()) {
        return null;
      }
      out.push({ project, sessions });
    } catch (error) {
      console.warn(`preloadSession: failed to scan project ${project.name}:`, error);
    }
  }
  return out;
}

// ============================================================================
// Per-kind resolvers
// ============================================================================

async function resolveUuid(
  uuid: string,
  projects: ClaudeProject[],
  isCurrent: () => boolean,
): Promise<SessionPickerCandidate | null> {
  const { excludeSidechain } = useAppStore.getState();
  for (const project of projects) {
    if (!isCurrent()) return null;
    try {
      const sessions = await loadSessionsFor(project, excludeSidechain);
      if (!isCurrent()) return null;
      const session = matchByUuid(sessions, uuid);
      if (session) return { project, session };
    } catch (error) {
      console.warn(`preloadSession: failed to scan project ${project.name}:`, error);
    }
  }
  return null;
}

async function resolvePath(
  absPath: string,
  projects: ClaudeProject[],
  isCurrent: () => boolean,
): Promise<SessionPickerCandidate | null> {
  const { excludeSidechain } = useAppStore.getState();
  for (const project of projects) {
    if (!isCurrent()) return null;
    try {
      const sessions = await loadSessionsFor(project, excludeSidechain);
      if (!isCurrent()) return null;
      const session = matchByPath(sessions, absPath);
      if (session) return { project, session };
    } catch (error) {
      console.warn(`preloadSession: failed to scan project ${project.name}:`, error);
    }
  }
  return null;
}

async function resolveFolder(
  folderName: string,
  projects: ClaudeProject[],
  isCurrent: () => boolean,
): Promise<SessionPickerCandidate | null> {
  // Folder name matches the project directory name, not the full path.
  const lower = folderName.toLowerCase();
  const target = projects.find((p) => {
    // `path` is the sesslog project directory: /Users/.../.claude/projects/<folder>
    const parts = p.path.split(/[\\/]/);
    const name = parts[parts.length - 1] ?? "";
    return name.toLowerCase() === lower;
  });
  if (!target || !isCurrent()) return null;

  try {
    const { excludeSidechain } = useAppStore.getState();
    const sessions = await loadSessionsFor(target, excludeSidechain);
    if (!isCurrent()) return null;
    // Pick the most recently modified session as the "default" for a folder hint.
    const sorted = [...sessions].sort((a, b) => {
      const at = a.last_modified ?? "";
      const bt = b.last_modified ?? "";
      return bt.localeCompare(at);
    });
    const session = sorted[0];
    if (session) return { project: target, session };
  } catch (error) {
    console.warn(`preloadSession: failed to load folder ${folderName}:`, error);
  }
  return null;
}

/**
 * Resolve a title hint by scanning every project and collecting all substring
 * matches. Returns the list so the caller can decide: zero → toast, one →
 * auto-select, multi → open picker modal.
 *
 * Returns `null` when the race guard tripped mid-scan.
 */
async function resolveTitle(
  substring: string,
  projects: ClaudeProject[],
  isCurrent: () => boolean,
): Promise<SessionPickerCandidate[] | null> {
  const scanned = await scanAllProjects(projects, isCurrent);
  if (scanned === null) return null;

  const candidates: SessionPickerCandidate[] = [];
  for (const { project, sessions } of scanned) {
    if (!isCurrent()) return null;
    for (const session of matchByTitle(sessions, substring)) {
      candidates.push({ project, session });
    }
  }
  return candidates;
}

// ============================================================================
// Main entry point
// ============================================================================

export async function preloadSessionFromCli(
  deps: PreloadDependencies,
): Promise<{ handled: boolean; matched: boolean }> {
  const isCurrent = () => deps.isCurrent?.() ?? true;
  if (!isCurrent()) {
    return { handled: true, matched: false };
  }

  const hint = await deps.getStartupSessionHint();
  if (!hint || !isCurrent()) {
    return { handled: false, matched: false };
  }

  // Dispatch per kind.
  if (hint.kind === "uuid") {
    return commitSingleMatch(
      await resolveUuid(hint.value, deps.projects, isCurrent),
      deps,
      isCurrent,
    );
  }
  if (hint.kind === "path") {
    return commitSingleMatch(
      await resolvePath(hint.value, deps.projects, isCurrent),
      deps,
      isCurrent,
    );
  }
  if (hint.kind === "folder") {
    return commitSingleMatch(
      await resolveFolder(hint.value, deps.projects, isCurrent),
      deps,
      isCurrent,
    );
  }
  if (hint.kind === "title") {
    const matches = await resolveTitle(hint.value, deps.projects, isCurrent);
    if (matches === null || !isCurrent()) {
      // Race guard tripped during scan — user chose something else.
      return { handled: true, matched: false };
    }
    if (matches.length === 0) {
      toast.error(deps.t("globalSearch.sessionNotFound", "Session not found"));
      return { handled: true, matched: false };
    }
    if (matches.length === 1) {
      return commitSingleMatch(matches[0] ?? null, deps, isCurrent);
    }
    // Multi-match: delegate to the picker modal.
    if (!isCurrent()) {
      return { handled: true, matched: false };
    }
    deps.openSessionPicker(matches, hint.value);
    return { handled: true, matched: false };
  }

  console.warn(`preloadSession: unsupported hint kind "${(hint as SessionHint).kind}"`);
  return { handled: true, matched: false };
}

/**
 * Apply a resolved single match. If a newer navigation superseded the hint,
 * suppress both the toast and the move.
 */
async function commitSingleMatch(
  match: SessionPickerCandidate | null,
  deps: PreloadDependencies,
  isCurrent: () => boolean,
): Promise<{ handled: boolean; matched: boolean }> {
  if (!isCurrent()) {
    return { handled: true, matched: false };
  }
  if (!match) {
    toast.error(deps.t("globalSearch.sessionNotFound", "Session not found"));
    return { handled: true, matched: false };
  }
  // `navigate` re-checks its epoch after the project load, so a session the
  // user clicked meanwhile is not clobbered by the hint.
  const arrived = await deps.openMatch(match);
  return { handled: true, matched: arrived && isCurrent() };
}

export interface OpenSessionHintOptions {
  /** Explicit message target inside the matched session (deep link). */
  messageId?: string | null;
  /** An epoch already claimed for this hint; claimed now when omitted. */
  epoch?: number;
  /** Record the move in back/forward history (default true). */
  record?: boolean;
  t: Translator;
}

/**
 * Resolve a CLI / deep-link hint against the store and open it.
 *
 * The hint owns a navigation epoch from the moment it is accepted. Any later
 * navigation (the user's click, a newer hint, a browser back) supersedes it;
 * reloads and an already open session do not. That is the startup priority
 * (plan §4.3): an explicit hint wins over whatever is on screen, including a
 * session opened before a second launch (§9b F4).
 */
export function openSessionHint(
  hint: SessionHint,
  options: OpenSessionHintOptions,
): Promise<{ handled: boolean; matched: boolean }> {
  const epoch = options.epoch ?? useAppStore.getState().beginNavigation();
  const isCurrent = () => useAppStore.getState().navigationEpoch === epoch;
  return preloadSessionFromCli({
    getStartupSessionHint: () => Promise.resolve(hint),
    projects: useAppStore.getState().projects,
    openMatch: ({ project, session }) =>
      useAppStore.getState().navigate(
        {
          view: "conversation",
          project,
          session,
          messageId: options.messageId ?? null,
        },
        { history: "none", epoch, record: options.record },
      ),
    openSessionPicker: (candidates, hintValue) =>
      useAppStore.getState().openSessionPicker(candidates, hintValue),
    t: options.t,
    isCurrent,
  });
}
