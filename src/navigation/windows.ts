/**
 * Several desktop windows (issue #656).
 *
 * Every window runs its own page - its own store, tabs, navigation and
 * selection; the backend, its caches and the file watcher are shared. A
 * window opens empty (New Window, ⌘N / Ctrl+Shift+N) or on a project or
 * session (a sidebar row's "Open in New Window"). The backend keeps that
 * target for the new window (`open_window`), which asks for it once its
 * projects are loaded (`get_window_target`) and opens it the way a sidebar
 * click would. Only the window created at launch (`main`) restores and saves
 * the tabs of the last run (`documentSlice`, `startTabsPersistence`); a
 * window opened later starts with one empty tab and keeps its tabs while it
 * is open. The WebUI has one window per browser tab and none of this.
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { isTauri } from "@/utils/platform";
import { libraryRefOf } from "./library";
import { findSession } from "./openSessionRef";
import { projectRefOf, type ProjectRef, type SessionRef } from "./place";
import { openHintInTab } from "./tabs";

/** What a new window opens (`WindowTarget` in `src-tauri/src/multi_window.rs`). */
export type WindowTarget =
  | { kind: "project"; project: ProjectRef }
  | { kind: "session"; session: SessionRef };

/** Whether this runtime can open windows (the desktop app). */
export const canOpenWindows = (): boolean => isTauri();

/** A window on `project`. */
export function projectWindowTarget(project: ClaudeProject): WindowTarget {
  return { kind: "project", project: projectRefOf(project) as ProjectRef };
}

/** A window on `session`, listed by `project` when known. */
export function sessionWindowTarget(session: ClaudeSession, project?: ClaudeProject | null): WindowTarget {
  return { kind: "session", session: libraryRefOf(session, project) };
}

/** Open a new window, empty or on `target`. Resolves to its label. */
export function openNewWindow(target: WindowTarget | null = null): Promise<string> {
  return api<string>("open_window", { target });
}

/** Open a new window on `target`; a failure is reported with a toast. */
export function openInNewWindow(target: WindowTarget): void {
  openNewWindow(target).catch((error: unknown) => {
    console.error("Failed to open a new window:", error);
    toast.error(i18n.t("common.window.openFailed"));
  });
}

/** What this window was opened for: none in `main`, a fresh window and the WebUI. */
export async function fetchWindowTarget(): Promise<WindowTarget | null> {
  if (!isTauri()) return null;
  try {
    return await api<WindowTarget | null>("get_window_target");
  } catch (error) {
    console.error("get_window_target failed:", error);
    return null;
  }
}

const providerOf = (p: { provider?: string }) => p.provider ?? "claude";

/** How a window target opens; `App` hands in its sidebar's project opener. */
export interface WindowTargetOpeners {
  openProject: (project: ClaudeProject) => Promise<boolean>;
}

/**
 * Open what this window was opened for, as the sidebar would: the project
 * (its screen follows), or the session in the empty first tab. It claims the
 * navigation first, so a click made meanwhile wins; a project or session
 * that is gone since is reported, and the window stays on its start screen.
 */
export async function openWindowTarget(target: WindowTarget, openers: WindowTargetOpeners): Promise<boolean> {
  const get = useAppStore.getState;
  if (target.kind === "project") {
    const { provider, path } = target.project;
    const project = get().projects.find((p) => providerOf(p) === provider && p.path === path);
    if (!project) {
      toast.error(i18n.t("common.window.projectNotFound"));
      return false;
    }
    return openers.openProject(project);
  }
  const epoch = get().beginNavigation();
  const owns = () => get().navigationEpoch === epoch;
  const found = await findSession(target.session, owns);
  if (found === "superseded" || !owns()) return false;
  if (!found) {
    toast.error(i18n.t("globalSearch.sessionNotFound"));
    return false;
  }
  return openHintInTab(found, { epoch, messageId: null });
}
