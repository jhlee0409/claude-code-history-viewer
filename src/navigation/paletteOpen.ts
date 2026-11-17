/**
 * Opening what the ⌘K palette found (plan T10): a project, a session or a
 * message. Each pick is a navigation (plan §4.2): it moves through
 * `navigate` - the project and session the way their sidebar rows open them
 * (`PlaceOpeners`, supplied by the shell), a message as the session plus an
 * explicit message target, which outranks a saved scroll anchor (§4.3).
 *
 * Ownership: an opener claims the navigation epoch before its first await,
 * so a later click, tab switch or browser back owns the screen, whichever
 * lookup finishes first; a superseded pick writes nothing and says nothing.
 * With the action modifier (⌘ on macOS, Ctrl elsewhere) the pick opens in a
 * new tab (T8), which goes away again when nothing opened.
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { loadSessionsFor } from "@/lib/preloadSession";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeMessage, ClaudeProject, ClaudeSession } from "@/types";
import type { SessionTarget } from "@/commands/paletteSources";
import { openSessionRef } from "./openSessionRef";
import { ownPlace } from "./ownership";
import { projectForSearchResult, projectIdentityKey } from "@/utils/projectIdentity";
import { openInNewTab } from "./tabs";

/** How the shell opens a project and a session (its sidebar handlers). */
export interface PlaceOpeners {
  /** Resolves whether the project opened (false: superseded or failed). */
  openProject: (project: ClaudeProject) => Promise<boolean>;
  /** `owner`: the project that lists the session. */
  openSession: (session: ClaudeSession, owner?: ClaudeProject) => Promise<boolean>;
}

const get = () => useAppStore.getState();

/** Openers without a shell (a palette rendered on its own): plain moves. */
export const DEFAULT_PLACE_OPENERS: PlaceOpeners = {
  openProject: (project) => get().navigate({ project }),
  openSession: (session, owner) => get().navigate({ view: "conversation", project: owner, session }),
};

/** Open a session row: a loaded one as its sidebar row, a library entry by its ref. */
export async function openSessionTarget(target: SessionTarget, openers: PlaceOpeners): Promise<boolean> {
  if (target.kind === "loaded") return openers.openSession(target.session, target.project);
  return (await openSessionRef(target.ref)) === "opened";
}

const sameSession = (result: ClaudeMessage) => (s: ClaudeSession) =>
  s.session_id === result.sessionId || s.actual_session_id === result.sessionId;

/**
 * Open a message result: its session - from the open project's loaded list
 * when it is there, else looked up in the projects most likely to list it -
 * with the message as the explicit target. Resolves whether it opened.
 */
export async function openMessageResult(result: ClaudeMessage): Promise<boolean> {
  const epoch = get().beginNavigation();
  const owns = () => get().navigationEpoch === epoch;
  const messageId = result.uuid ?? null;
  try {
    const { sessions, projects, selectedProject, excludeSidechain } = get();
    const provider = result.provider ?? "claude";
    const exactProject = projectForSearchResult(result, projects);
    const loadedProjectMatches = selectedProject != null &&
      (selectedProject.provider ?? "claude") === provider &&
      (result.projectPath != null
        ? selectedProject.path === result.projectPath
        : exactProject != null && projectIdentityKey(selectedProject) === projectIdentityKey(exactProject));
    const loaded = loadedProjectMatches ? sessions.find(sameSession(result)) : undefined;
    if (loaded) {
      return await get().navigate({ view: "conversation", session: loaded, messageId }, { epoch });
    }

    // A path-qualified result must never fall back to a same-named directory.
    // Legacy name-only results retain their session lookup within the provider.
    const rank = (project: ClaudeProject): number => {
      if ((project.provider ?? "claude") !== provider) return 3;
      if (result.projectName && project.name === result.projectName) return 0;
      if (
        result.projectName &&
        (project.name.includes(result.projectName) || project.actual_path?.endsWith(result.projectName))
      ) {
        return 1;
      }
      return 2;
    };
    const candidates = result.projectPath != null
      ? (exactProject ? [exactProject] : [])
      : projects.filter((project) => (project.provider ?? "claude") === provider).sort((a, b) => rank(a) - rank(b));
    const findIn = async (project: ClaudeProject) => {
      try {
        const session = (await loadSessionsFor(project, excludeSidechain)).find(sameSession(result));
        return session ? { project, session } : null;
      } catch (error) {
        console.error(`Palette: failed to load sessions for ${project.name}:`, error);
        return null;
      }
    };
    const BATCH = 4;
    for (let i = 0; i < candidates.length; i += BATCH) {
      if (!owns()) return false;
      const found = (await Promise.all(candidates.slice(i, i + BATCH).map(findIn))).find((hit) => hit !== null);
      if (!owns()) return false;
      if (found) {
        return await get().navigate(
          { view: "conversation", project: found.project, session: found.session, messageId },
          { epoch },
        );
      }
    }
    if (!owns()) return false;
    toast.error(i18n.t("globalSearch.sessionNotFound"));
    return false;
  } catch (error) {
    if (!owns()) return false;
    console.error("Palette: failed to open a message result:", error);
    toast.error(i18n.t("globalSearch.navigationFailed"));
    return false;
  }
}

/**
 * Run a palette pick, in a new tab when `inNewTab`. A pick that rejects or
 * throws shows one toast - unless a newer navigation already owns the screen
 * (ownership is taken right after the opener has claimed its own) - and
 * resolves false.
 */
export async function runPaletteOpen(open: () => Promise<boolean>, inNewTab: boolean): Promise<boolean> {
  let opening: Promise<boolean>;
  try {
    opening = inNewTab ? openInNewTab(open, { discardIf: (opened) => !opened }) : Promise.resolve(open());
  } catch (error) {
    opening = Promise.reject(error);
  }
  const owns = ownPlace(get);
  try {
    return await opening;
  } catch (error) {
    if (!owns()) return false;
    console.error("Palette: failed to open the pick:", error);
    toast.error(i18n.t("globalSearch.navigationFailed"));
    return false;
  }
}
