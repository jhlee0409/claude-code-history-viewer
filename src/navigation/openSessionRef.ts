/**
 * Open a session named by its `SessionRef` (the sidebar library's recent and
 * favourite entries, plan T7): find the project that lists it, find the
 * session in that project's list - loaded the way the sidebar loads it
 * (`loadSessionsFor`) - and navigate there.
 *
 * Where it looks, each project once and most likely first
 * (`candidateProjects`):
 * 1. the open project's list, already in the store (no load);
 * 2. the project the ref names (`projectPath`);
 * 3. the project whose storage path holds the file (Claude Code-style
 *    providers, refs saved before `projectPath` existed);
 * 4. only when the ref names no listed project: the provider's other
 *    projects. Most providers list projects under a virtual path
 *    (`codex://{cwd}`), so the file path alone does not name the project.
 *
 * Any navigation that begins while the lists load owns the screen; this one
 * then gives up silently (`ownPlace`).
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { loadSessionsFor, matchByPath, openSessionHint } from "@/lib/preloadSession";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { ownPlace } from "./ownership";
import { findProjectForSessionPath } from "./library";
import type { SessionRef } from "./place";

export type OpenSessionRefResult = "opened" | "notFound" | "superseded";

interface Found {
  project: ClaudeProject;
  session: ClaudeSession;
}

const providerOf = (p: { provider?: string }) => p.provider ?? "claude";

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

async function findSession(ref: SessionRef, owns: () => boolean): Promise<Found | null | "superseded"> {
  const { projects, selectedProject, sessions, excludeSidechain } = useAppStore.getState();
  let failure: unknown = null;
  for (const project of candidateProjects(ref, projects, selectedProject)) {
    let list: ClaudeSession[];
    if (project === selectedProject) {
      list = sessions;
    } else {
      try {
        list = await loadSessionsFor(project, excludeSidechain);
      } catch (error) {
        if (!owns()) return "superseded";
        console.warn(`openSessionRef: failed to load ${project.name}:`, error);
        failure ??= error;
        continue;
      }
      if (!owns()) return "superseded";
    }
    const session = matchByPath(list, ref.filePath);
    if (session) return { project, session };
  }
  // Nothing matched and a list failed to load: an error, not "gone".
  if (failure) throw failure;
  return null;
}

export async function openSessionRef(ref: SessionRef): Promise<OpenSessionRefResult> {
  const get = useAppStore.getState;
  const owns = ownPlace(get);
  const found = await findSession(ref, owns);
  if (found === "superseded" || !owns()) return "superseded";
  if (!found) {
    toast.error(i18n.t("globalSearch.sessionNotFound"));
    return "notFound";
  }
  const arrived = await get().navigate({ view: "conversation", project: found.project, session: found.session });
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
