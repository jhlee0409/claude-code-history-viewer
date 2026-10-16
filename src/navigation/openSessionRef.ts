/**
 * Open a session named by its `SessionRef` (the sidebar library's recent and
 * favourite entries, plan T7): find the project that lists it, find the
 * session in that project's list - loaded the way the sidebar loads it
 * (`loadSessionsFor`) - and navigate there.
 *
 * Where it looks, each project once and most likely first
 * (`candidateProjects`):
 * 1. the open project's list, already in the store (no load) - proof of
 *    absence only when it is complete; a list still loading or holding only
 *    its first pages is followed by a direct lookup (`lookUpBeyondList`);
 * 2. the project the ref names (`projectPath`);
 * 3. the project whose storage path holds the file (Claude Code-style
 *    providers, refs saved before `projectPath` existed);
 * 4. only when the ref names no listed project: the provider's other
 *    projects. Most providers list projects under a virtual path
 *    (`codex://{cwd}`), so the file path alone does not name the project.
 *
 * The click is a navigation from the moment it is made (plan T2 §4.2): it
 * claims the navigation epoch before its first await, as a CLI hint does
 * (`openSessionHint`), and hands that epoch to `navigate`. A later click, a
 * hint, a browser back - any navigation that begins while the lists load -
 * owns the screen, whichever lookup finishes first; this one then gives up
 * silently, without a toast even when its lookup failed.
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { loadSessionsFor, matchByPath, openSessionHint } from "@/lib/preloadSession";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { findProjectForSessionPath } from "./library";
import type { SessionRef } from "./place";

export type OpenSessionRefResult = "opened" | "notFound" | "superseded";

export interface Found {
  project: ClaudeProject;
  session: ClaudeSession;
}

const providerOf = (p: { provider?: string }) => p.provider ?? "claude";

/** The open project's list as the store holds it (`projectSlice`). */
interface OpenProjectList {
  sessions: ClaudeSession[];
  /** More pages exist beyond `sessions`. */
  hasMoreSessions: boolean;
  isLoadingSessions: boolean;
  isLoadingMoreSessions: boolean;
}

/** The projects to search for `ref`, most likely first, each once. */
export function candidateProjects(
  ref: SessionRef,
  projects: readonly ClaudeProject[],
  openProject: ClaudeProject | null,
): ClaudeProject[] {
  const out: ClaudeProject[] = [];
  const add = (p: ClaudeProject | null | undefined) => {
    if (!p || providerOf(p) !== ref.provider) return;
    if (out.some((o) => o.path === p.path)) return;
    out.push(p);
  };
  add(openProject);
  const named = ref.projectPath
    ? projects.find((p) => providerOf(p) === ref.provider && p.path === ref.projectPath)
    : undefined;
  add(named);
  add(findProjectForSessionPath(projects, ref.filePath, ref.provider));
  // A ref whose project is listed but does not hold it any more: the session
  // is gone, and reading every other project would not find it either.
  if (!named) projects.forEach(add);
  return out;
}

/**
 * The project listing `ref` and its session, looked up the way `openSessionRef`
 * opens it (a tab restoring its session uses it too). Null: gone; throws when
 * nothing matched and a list failed to load; "superseded" once `owns` fails.
 */
export async function findSession(ref: SessionRef, owns: () => boolean): Promise<Found | null | "superseded"> {
  const state = useAppStore.getState();
  const { projects, selectedProject, excludeSidechain } = state;
  let failure: unknown = null;
  for (const project of candidateProjects(ref, projects, selectedProject)) {
    const isOpen = project === selectedProject;
    if (isOpen) {
      // The loaded list first, without a load. A miss there settles it only
      // when the list is complete (`isCompleteList`).
      const cached = matchByPath(state.sessions, ref.filePath);
      if (cached) return { project, session: cached };
      if (isCompleteList(state)) continue;
      // The ref names another project that is still listed: the open one
      // cannot hold it, so its loaded list was enough of a check. A stale
      // projectPath (no such project now) proves nothing - keep looking.
      if (
        ref.projectPath &&
        ref.projectPath !== project.path &&
        projects.some((p) => providerOf(p) === ref.provider && p.path === ref.projectPath)
      ) {
        continue;
      }
    }
    let session: ClaudeSession | undefined;
    try {
      session = isOpen
        ? await lookUpBeyondList(project, ref, excludeSidechain)
        : matchByPath(await loadSessionsFor(project, excludeSidechain), ref.filePath);
    } catch (error) {
      if (!owns()) return "superseded";
      console.warn(`openSessionRef: failed to load ${project.name}:`, error);
      failure ??= error;
      continue;
    }
    if (!owns()) return "superseded";
    if (session) return { project, session };
  }
  // Nothing matched and a list failed to load: an error, not "gone".
  if (failure) throw failure;
  return null;
}

/**
 * Whether the open project's list in the store holds every session. The
 * sidebar loads it a page at a time (`hasMoreSessions`) and holds nothing
 * while the first page loads, so a miss in any other list says nothing.
 */
const isCompleteList = (list: OpenProjectList): boolean =>
  !list.hasMoreSessions && !list.isLoadingSessions && !list.isLoadingMoreSessions;

/**
 * Find a session of the open project that its loaded list does not hold:
 * by its file for Claude Code (`load_provider_session_by_path`, the lookup
 * `loadProjectSessions` uses for a selection beyond the first page), else -
 * or when that lookup fails - in the project's full list. The session then
 * opens without being in the loaded page.
 */
async function lookUpBeyondList(
  project: ClaudeProject,
  ref: SessionRef,
  excludeSidechain: boolean,
): Promise<ClaudeSession | undefined> {
  if (providerOf(project) === "claude") {
    try {
      const found = await api<ClaudeSession | null>("load_provider_session_by_path", {
        provider: "claude",
        projectPath: project.path,
        filePath: ref.filePath,
        excludeSidechain,
      });
      return found ?? undefined;
    } catch (error) {
      // A rejected path: the project's list still knows.
      console.warn(`openSessionRef: single-session lookup failed in ${project.name}:`, error);
    }
  }
  return matchByPath(await loadSessionsFor(project, excludeSidechain), ref.filePath);
}

export async function openSessionRef(ref: SessionRef): Promise<OpenSessionRefResult> {
  const get = useAppStore.getState;
  const epoch = get().beginNavigation();
  const owns = () => get().navigationEpoch === epoch;
  let found: Awaited<ReturnType<typeof findSession>>;
  try {
    found = await findSession(ref, owns);
  } catch (error) {
    if (!owns()) return "superseded";
    throw error;
  }
  if (found === "superseded" || !owns()) return "superseded";
  if (!found) {
    toast.error(i18n.t("globalSearch.sessionNotFound"));
    return "notFound";
  }
  const arrived = await get().navigate(
    { view: "conversation", project: found.project, session: found.session },
    { epoch },
  );
  return arrived ? "opened" : "superseded";
}

/**
 * A favourite starred before refs existed: only its id is known, so it is
 * found the way a CLI `--session <uuid>` is (every project scanned).
 */
export function openLegacyFavorite(sessionId: string): Promise<{ handled: boolean; matched: boolean }> {
  return openSessionHint(
    { kind: "uuid", value: sessionId },
    { t: (key, fallback) => i18n.t(key, { defaultValue: fallback ?? key }) },
  );
}
